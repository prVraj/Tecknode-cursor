import { after, NextResponse } from "next/server";
import { z } from "zod";
import { buildIdempotencyKey, connectorKeyFor } from "@/lib/intel/keys";
import { executeConnectorRun } from "@/lib/intel/runner";
import { getAccountContextOrJson } from "@/server/action-utils";
import { connectorRunRepo } from "@/server/db/repos/connector-run.repo";
import { trackedEntityRepo } from "@/server/db/repos/tracked-entity.repo";
import { CAPABILITY_KEYS } from "@/server/db/schema";
import logger from "@/utils/logger";

// Give the function room to actually run the module.
export const maxDuration = 300;

const bodySchema = z.object({
  entityId: z.string().min(1),
  capabilityKey: z.enum(CAPABILITY_KEYS),
});

export async function POST(req: Request) {
  const ctx = await getAccountContextOrJson();
  if (ctx instanceof NextResponse) return ctx;

  try {
    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => i.message).join(", ") },
        { status: 400 },
      );
    }
    const { entityId, capabilityKey } = parsed.data;

    const entity = await trackedEntityRepo.findByIdForUser(
      entityId,
      ctx.userId,
    );
    if (!entity) {
      return NextResponse.json(
        { error: "Tracked entity not found" },
        { status: 404 },
      );
    }

    logger.info("intel refresh requested (Run Now)", {
      module: "intel-refresh",
      userId: ctx.userId,
      entityId,
      "run.capability": capabilityKey,
    });

    const idempotencyKey = buildIdempotencyKey(capabilityKey, entityId);
    let run = await connectorRunRepo.enqueue({
      userId: ctx.userId,
      entityId,
      capabilityKey,
      connectorKey: connectorKeyFor(capabilityKey),
      status: "pending",
      idempotencyKey,
    });

    if (!run) {
      run = await connectorRunRepo.findByIdempotencyKey(idempotencyKey);
    }

    if (!run) {
      return NextResponse.json(
        { error: "Could not enqueue run" },
        { status: 500 },
      );
    }

    // Manual trigger — reset any terminal run (failed or succeeded) so it reruns.
    if (run.status === "failed" || run.status === "succeeded") {
      const reset = await connectorRunRepo.forceResetToPending(run.id);
      if (reset) run = reset;
    }

    // Fire-and-forget dispatch — client polls /api/intel/runs/[id].
    if (run.status === "pending") {
      const runId = run.id;
      after(
        executeConnectorRun(runId).catch((err) => {
          logger.warn(
            "executeConnectorRun rejected (already logged inside runner)",
            {
              "run.id": runId,
              "error.message": err instanceof Error ? err.message : String(err),
              module: "intel-refresh",
            },
          );
        }),
      );
    }

    return NextResponse.json({
      runId: run.id,
      status: run.status,
      alreadyQueued: run.status !== "pending",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error("Intel refresh handler error", {
      "error.message": message,
      "error.stack": error instanceof Error ? error.stack : undefined,
      module: "intel-refresh",
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
