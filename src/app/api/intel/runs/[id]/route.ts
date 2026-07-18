import { NextResponse } from "next/server";
import { toPublicConnectorRun } from "@/lib/intel/connector-errors";
import { getAccountContextOrJson } from "@/server/action-utils";
import { connectorRunRepo } from "@/server/db/repos/connector-run.repo";
import logger from "@/utils/logger";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getAccountContextOrJson();
  if (ctx instanceof NextResponse) return ctx;

  try {
    const { id } = await params;

    const run = await connectorRunRepo.findById(id);
    if (!run) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    // Forged foreign IDs must leak nothing: report a run owned by another
    // user as "not found", not "forbidden" (which would confirm existence).
    if (run.userId !== ctx.userId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json(toPublicConnectorRun(run));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error("Intel run fetch error", {
      "error.message": message,
      module: "intel-runs",
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
