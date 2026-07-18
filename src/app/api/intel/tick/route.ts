import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron-auth";
import {
  DEFAULT_DRAIN_CONCURRENCY,
  DEFAULT_DRAIN_LIMIT,
  drainPendingRuns,
  reclaimGhostRuns,
} from "@/lib/intel/runner";
import { enqueueDailyRuns } from "@/lib/intel/scheduler";
import { intelTickRepo } from "@/server/db/repos/intel-tick.repo";
import logger from "@/utils/logger";

// Vercel Pro/Enterprise cap for standard functions is 800s. Under Fluid
// compute Active CPU billing pauses during upstream I/O waits — which this
// tick does ~90% of the time — so the extra headroom is essentially free.
//
// Budget: drain STOPS claiming new runs once `CRON_TICK_BUDGET_MS` of
// wall-clock has elapsed. Up to `DEFAULT_DRAIN_CONCURRENCY` runs may still be
// claimed just before the cutoff; each then finishes + does serial post-run
// DB writes.
export const maxDuration = 800;
const CRON_TICK_BUDGET_MS = 400_000;

/**
 * Cron entry point — runs daily.
 *
 * 1. `reclaimGhostRuns` — recover rows stuck in `running` past the stale
 *    threshold (worker killed mid-execution) so they're eligible for THIS drain.
 * 2. `enqueueDailyRuns` — write today's `connector_runs` for every
 *    (user, entity, enabled-capability) — idempotent within the day bucket.
 * 3. `drainPendingRuns` — execute pending runs concurrently with bounded
 *    wall-clock. Anything not reached stays `pending`; the next tick (or a
 *    manual /refresh call) picks it up.
 */
export async function GET(req: Request) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tickStartedAt = Date.now();
  const url = new URL(req.url);
  const drainLimit = clampInt(
    url.searchParams.get("limit"),
    DEFAULT_DRAIN_LIMIT,
    1,
    1000,
  );
  const drainConcurrency = clampInt(
    url.searchParams.get("concurrency"),
    DEFAULT_DRAIN_CONCURRENCY,
    1,
    32,
  );

  // Record this tick in intel_ticks the moment we start so it's visible even
  // if it does nothing (everything already enqueued, no backlog to drain) or
  // crashes mid-flight.
  const tick = await intelTickRepo.start({ source: "cron" });
  if (!tick) {
    logger.error("intel.tick.start_failed", { module: "intel-tick" });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }

  try {
    const reclaimedGhosts = await reclaimGhostRuns();
    const enqueueStart = Date.now();
    const scheduled = await enqueueDailyRuns(new Date(), tick.id);
    const enqueueDurationMs = Date.now() - enqueueStart;

    const drainStart = Date.now();
    const drained = await drainPendingRuns({
      limit: drainLimit,
      concurrency: drainConcurrency,
      budgetMs: CRON_TICK_BUDGET_MS,
      tickId: tick.id,
    });
    const drainDurationMs = Date.now() - drainStart;

    await intelTickRepo.finish(tick.id, {
      reclaimedGhosts,
      // Column is named `orgs_scanned` (pre-migration naming); this build has
      // no organization concept, so it now carries the per-user scan count.
      orgsScanned: scheduled.usersScanned,
      entitiesScanned: scheduled.entitiesScanned,
      enqueued: scheduled.enqueued,
      skippedAlreadyEnqueued: scheduled.skippedAlreadyEnqueued,
      skippedByCadence: scheduled.skippedByCadence,
      skippedByEntityScope: scheduled.skippedByEntityScope,
      processed: drained.processed,
      succeeded: drained.succeeded,
      failed: drained.failed,
      skipped: drained.skipped,
      drainTimedOut: drained.timedOut,
      drainLimit,
      drainConcurrency,
    });

    // Single fat log carrying every decision input + per-stage timing. Lets
    // ops answer "did this tick scale, fail to enqueue, or fail to drain?"
    // from one record. `...drained` carries processed/succeeded/failed/skipped/timedOut.
    logger.info("intel.tick.complete", {
      module: "intel-tick",
      reclaimedGhosts,
      ...scheduled,
      ...drained,
      enqueueDurationMs,
      drainLimit,
      drainConcurrency,
      drainDurationMs,
      totalDurationMs: Date.now() - tickStartedAt,
    });

    return NextResponse.json({
      ok: true,
      tickId: tick.id,
      reclaimedGhosts,
      scheduled,
      drained,
    });
  } catch (error) {
    await intelTickRepo.finish(tick.id, {
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    logger.error("intel.tick.failed", {
      module: "intel-tick",
      tickId: tick.id,
      thrown: true,
      drainLimit,
      drainConcurrency,
      durationMs: Date.now() - tickStartedAt,
      error,
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

function clampInt(
  raw: string | null,
  fallback: number,
  min: number,
  max: number,
): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}
