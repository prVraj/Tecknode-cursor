import { classifyError } from "@/lib/alerts/classify-error";
import {
  getCapabilityProducers,
  sortPendingRunsProducerFirst,
} from "@/lib/intel/capability-order";
import { mapConnectorError } from "@/lib/intel/connector-errors";
import {
  finalizeConnectorOutput,
  hasStoredDataIssues,
} from "@/lib/intel/connector-output";
import {
  buildSnapshotProvenance,
  wrapSnapshotPayload,
} from "@/lib/intel/provenance";
import { withApiUsageContext } from "@/lib/observability/api-usage";
import { connectorRunRepo } from "@/server/db/repos/connector-run.repo";
import { signalRepo } from "@/server/db/repos/signal.repo";
import { signalSnapshotRepo } from "@/server/db/repos/signal-snapshot.repo";
import { trackedEntityRepo } from "@/server/db/repos/tracked-entity.repo";
import {
  CAPABILITY_META,
  type CapabilityKey,
  type CapabilityMeta,
  type ConnectorRun,
  type TrackedEntity,
} from "@/server/db/schema";
import logger from "@/utils/logger";
import { hasChangeSignals } from "./diff/emit-signal";
import type { ModuleRunResult } from "./dispatcher";
import { getModuleRunner } from "./dispatcher";
import { getFetchCacheStats, resetFetchCacheStats } from "./fetch-cache";
import { validateModuleOutput } from "./output-schemas";
import { intelRunContext } from "./run-context";
import { buildBaselineSignal, buildScoreDeltaSignal } from "./score-threshold";

const log = logger.withContext({ module: "intel-runner" });

function extractDotPath(
  obj: Record<string, unknown>,
  path: string | null,
): number | null {
  if (!path) return null;
  let val: unknown = obj;
  for (const part of path.split(".")) {
    if (val == null || typeof val !== "object") return null;
    val = (val as Record<string, unknown>)[part];
  }
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    const n = Number.parseFloat(val);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

/** Run id of the producer whose same-day snapshot this one derived from. */
async function resolveProducerRunId(params: {
  entityId: string;
  derivedFrom: CapabilityKey[];
  capturedDate: string;
}): Promise<string | undefined> {
  const primaryProducer = params.derivedFrom[0];
  if (!primaryProducer) return undefined;

  const producerSnapshot = await signalSnapshotRepo.findLatest(
    params.entityId,
    primaryProducer,
  );
  if (
    !producerSnapshot ||
    producerSnapshot.capturedDate !== params.capturedDate
  ) {
    return undefined;
  }

  return producerSnapshot.runId ?? undefined;
}

/**
 * Modules that report on a lagging window (e.g. "yesterday's" revenue) set
 * `result.capturedDate` to the date the value actually represents, so it
 * stays aligned with the data instead of drifting to the run's wall-clock
 * date. Defaults to `todayDate` for modules that don't set it.
 */
function resolveCapturedDate(
  result: ModuleRunResult,
  todayDate: string,
): string {
  return result.capturedDate ?? todayDate;
}

async function persistSnapshotAndScoreDelta(params: {
  claimed: ConnectorRun;
  entity: TrackedEntity;
  result: ModuleRunResult;
  meta: CapabilityMeta;
}): Promise<void> {
  const { claimed, entity, result, meta } = params;
  const capabilityKey = claimed.capabilityKey as CapabilityKey;
  const todayDate = new Date().toISOString().slice(0, 10);
  const capturedDate = resolveCapturedDate(result, todayDate);
  const primaryScore = extractDotPath(result.output, meta.primaryScoreField);
  const hasDataIssues = hasStoredDataIssues(result.output);
  const priorSnapshot = await signalSnapshotRepo.findPreviousScored(
    claimed.entityId,
    capabilityKey,
    capturedDate,
  );

  // A degraded or unscored snapshot is not a usable comparison point. Collapse
  // it to `null` so it takes the baseline branch, rather than being truthy
  // enough to skip the baseline yet null-scored enough to skip the delta — that
  // combination silently swallowed the first clean run after any flaky day.
  // `findPreviousScored` already filters these out; this keeps the invariant
  // true locally, whichever query feeds `prior`.
  const prior =
    priorSnapshot?.primaryScore != null && !priorSnapshot.hasDataIssues
      ? priorSnapshot
      : null;

  // A run with data issues (failed upstream fetches, partial sources) can
  // degrade an absolute metric to 0 — comparing that against a healthy prior
  // fires a bogus "dropped 100% (X → 0)" signal. Only derive baseline/delta
  // signals from a trustworthy measurement.
  if (
    !hasChangeSignals(result.signals) &&
    primaryScore != null &&
    !hasDataIssues
  ) {
    if (!prior) {
      // No trustworthy prior measurement — emit a p3 baseline signal so users
      // can see the measurement in their feed immediately.
      const baselineSignal = buildBaselineSignal({
        userId: claimed.userId,
        entityId: claimed.entityId,
        capabilityKey,
        meta,
        currentScore: primaryScore,
        runId: claimed.id,
        entityDomain: entity.domain,
      });
      if (baselineSignal) {
        await signalRepo.upsertByDedupKey(baselineSignal);
      }
    } else if (prior.primaryScore != null) {
      // Non-null by construction; the check narrows the nullable column type.
      // Emit a delta signal if the score dropped past threshold.
      const previousScore = Number.parseFloat(prior.primaryScore);
      if (!Number.isNaN(previousScore)) {
        const deltaSignal = buildScoreDeltaSignal({
          userId: claimed.userId,
          entityId: claimed.entityId,
          capabilityKey,
          meta,
          currentScore: primaryScore,
          previousScore,
          runId: claimed.id,
          entityDomain: entity.domain,
        });
        if (deltaSignal) {
          await signalRepo.upsertByDedupKey(deltaSignal);
        }
      }
    }
  }

  const provenanceWithoutRun = buildSnapshotProvenance({
    capabilityKey,
    output: result.output,
    override: result.snapshotProvenance,
  });
  const provenance = {
    ...provenanceWithoutRun,
    producerRunId:
      provenanceWithoutRun.producerRunId ??
      // Match the producer snapshot for the SAME captured date as the row we're
      // writing — not wall-clock today. A lagging-window module reports on an
      // earlier date, and its lineage must point at that date's producer.
      (await resolveProducerRunId({
        entityId: claimed.entityId,
        derivedFrom: provenanceWithoutRun.derivedFrom,
        capturedDate,
      })),
  };

  await signalSnapshotRepo.upsert({
    userId: claimed.userId,
    entityId: claimed.entityId,
    runId: claimed.id,
    capabilityKey,
    category: meta.category,
    capturedAt: new Date(),
    capturedDate,
    // Don't persist a score from a run with data issues — it would poison the
    // next run's comparison and show a false dip in trend charts.
    primaryScore:
      !hasDataIssues && primaryScore != null ? String(primaryScore) : null,
    scoreDirection: meta.scoreDirection,
    payload: wrapSnapshotPayload(result.output, provenance),
    hasDataIssues,
  });
}

/**
 * Side-channel reporting for connector failures: classify the error and log a
 * structured warning for critical paid-provider failures so they're visible
 * in observability tooling. RunAgents also pinged a founder Discord webhook
 * here (`notifyFounderCritical`) — that alerting channel is out of scope for
 * this migration (no Discord/founder-ops infra was ported), so this is
 * log-only. Extracted to keep the catch block in `executeConnectorRun` under
 * the complexity budget.
 */
async function reportConnectorFailure(params: {
  claimed: ConnectorRun;
  err: unknown;
  message: string;
}): Promise<void> {
  // Defensive: never let this bubble. The caller's catch block must run
  // `connectorRunRepo.markFailed` after this, and an unhandled throw here
  // would skip that and leave the run stuck in `running` until the stale
  // sweeper picks it up.
  try {
    const { claimed, err, message } = params;
    const classification = classifyError(err);
    if (!classification) return;

    if (classification.severity === "critical") {
      log.error("critical connector failure", {
        provider: classification.provider,
        reason: classification.reason,
        capabilityKey: claimed.capabilityKey,
        "run.id": claimed.id,
        userId: claimed.userId,
        errorMessage: message,
        httpStatus: classification.httpStatus,
      });
    }
  } catch (reportErr) {
    log.error("reportConnectorFailure threw", {
      "run.id": params.claimed.id,
      "report.error": reportErr,
    });
  }
}

/**
 * Execute one pending connector_run end-to-end.
 *
 * - Claims the row (status pending → running, atomic).
 * - Loads the tracked entity.
 * - Dispatches to the right module.
 * - Persists output + upserts signals.
 * - Marks success / failure.
 *
 * Safe to call concurrently across workers: the `markRunning` update is
 * conditional on `status='pending'`, so only one caller wins.
 */
export async function executeConnectorRun(
  runId: string,
  tickId?: string | null,
): Promise<{ status: "succeeded" | "failed" | "skipped"; reason?: string }> {
  const claimed = await connectorRunRepo.markRunning(runId, tickId);
  if (!claimed) {
    return { status: "skipped", reason: "Run was not pending" };
  }

  log.info("connector run started", {
    "run.id": claimed.id,
    "run.capability": claimed.capabilityKey,
    userId: claimed.userId,
    entityId: claimed.entityId,
  });

  try {
    const entity = await trackedEntityRepo.findById(claimed.entityId);
    if (!entity) {
      const missingEntityError = mapConnectorError(
        new Error(`Tracked entity ${claimed.entityId} not found.`),
      );
      await connectorRunRepo.markFailed(claimed.id, {
        errorCode: missingEntityError.code,
        errorMessage: `Tracked entity ${claimed.entityId} not found.`,
      });
      return { status: "failed", reason: "Entity missing" };
    }

    const runner = getModuleRunner(claimed.capabilityKey as CapabilityKey);

    // Establish ambient run context so both (a) upstream's API-usage accounting
    // and (b) the fetch cache — each deep in client calls — can attribute every
    // upstream fetch to this capability without threading the key through every
    // module/client signature.
    const result = await withApiUsageContext(
      {
        userId: claimed.userId,
        entityId: claimed.entityId,
        runId: claimed.id,
        capabilityKey: claimed.capabilityKey,
      },
      () =>
        intelRunContext.run(
          {
            capabilityKey: claimed.capabilityKey,
            userId: claimed.userId,
            entityId: claimed.entityId,
            runId: claimed.id,
          },
          () =>
            runner({
              userId: claimed.userId,
              entity,
              run: claimed,
            }),
        ),
    );

    // Soft-fail Zod validation for registered capability schemas.
    // Unregistered capabilities pass through; mismatches stamp dataIssues so
    // score/delta writes are skipped while raw output is still persisted.
    const validated = validateModuleOutput(
      claimed.capabilityKey as CapabilityKey,
      result,
    );
    if (validated.validationFailed) {
      log.warn("module output failed schema validation", {
        "run.id": claimed.id,
        "run.capability": claimed.capabilityKey,
        userId: claimed.userId,
        issues: validated.issues.slice(0, 10),
      });
    }
    const validatedResult = validated.result;

    for (const signal of validatedResult.signals) {
      await signalRepo.upsertByDedupKey(signal);
    }

    const meta =
      CAPABILITY_META[claimed.capabilityKey as CapabilityKey] ?? null;
    const finalized = finalizeConnectorOutput({
      capabilityKey: claimed.capabilityKey as CapabilityKey,
      result: validatedResult,
      meta,
    });

    await connectorRunRepo.markSucceeded(claimed.id, {
      output: finalized.output,
      costUnits: finalized.costUnits,
    });

    if (meta) {
      await persistSnapshotAndScoreDelta({
        claimed,
        entity,
        result: finalized,
        meta,
      });
    }

    log.info("connector run completed", {
      "run.id": claimed.id,
      "run.capability": claimed.capabilityKey,
      userId: claimed.userId,
      entityId: claimed.entityId,
      signalCount: validatedResult.signals.length,
      // Cumulative fetch-cache counts so far this drain. Folded onto the
      // per-run log (which always fires) so the totals survive even when the
      // tick is killed at maxDuration before the end-of-drain summary logs.
      cacheStats: getFetchCacheStats(),
    });

    return { status: "succeeded" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn("Connector run failed", {
      "run.id": claimed.id,
      "run.capability": claimed.capabilityKey,
      userId: claimed.userId,
      entityId: claimed.entityId,
      // Same cumulative counts as the success path, so a drain that ends on a
      // failed run still leaves the latest cache totals in the logs.
      cacheStats: getFetchCacheStats(),
      error: err,
    });

    await reportConnectorFailure({ claimed, err, message });

    const mapped = mapConnectorError(err);
    await connectorRunRepo.markFailed(claimed.id, {
      errorCode: mapped.code,
      errorMessage: message.slice(0, 1000),
    });
    return { status: "failed", reason: message };
  }
}

/**
 * How many pending runs to fetch (and at most execute) in a single drain.
 * Each connector run is almost entirely I/O wait on a paid upstream, so the
 * real ceiling on a tick is wall-clock (`budgetMs` below), not this count.
 */
export const DEFAULT_DRAIN_LIMIT = 250;

/**
 * Concurrent in-flight runs per drain. Tuned to clear a few-hundred-row backlog
 * inside one 300s function while staying under Neon's pooled connection ceiling
 * and not hammering any single upstream's rate limit. Each "slot" pulls the next
 * pending run as soon as its current one settles.
 */
export const DEFAULT_DRAIN_CONCURRENCY = 8;

/**
 * A `running` row whose `started_at` is older than this is treated as a ghost
 * (worker died mid-execution) and reclaimed to `pending`. Must exceed both the
 * longest realistic single-run time and the cron route's `maxDuration` so a
 * concurrent, still-alive tick is never robbed of a run it's legitimately
 * executing.
 *
 * 20 min = 800s ceiling + ~400s safety margin. Bump if `maxDuration` grows
 * further.
 */
export const STALE_RUNNING_MS = 20 * 60 * 1000;

/**
 * Reclaim ghost `running` rows left behind by killed workers. Call this at the
 * top of a tick, before draining, so the freshly-reclaimed rows become eligible
 * for this same drain. Returns the count reclaimed.
 */
export async function reclaimGhostRuns(): Promise<number> {
  const reclaimed =
    await connectorRunRepo.reclaimStaleRunning(STALE_RUNNING_MS);
  if (reclaimed.length > 0) {
    log.warn("Reclaimed ghost connector runs", {
      count: reclaimed.length,
      olderThanMs: STALE_RUNNING_MS,
    });
  }
  return reclaimed.length;
}

/**
 * Drain helper: pick up to `limit` pending runs and execute them with bounded
 * concurrency, stopping early once `budgetMs` of wall-clock has elapsed so the
 * caller's function never blows its `maxDuration`. Used by `/api/intel/tick`.
 *
 * Anything not reached this drain stays `pending` and the next tick picks it
 * up — the only durable state is the row status, so a hard function kill
 * mid-drain loses no work (it just leaves ghosts for `reclaimGhostRuns` to
 * recover on the next tick).
 */
export async function drainPendingRuns(
  opts: {
    limit?: number;
    concurrency?: number;
    /** Stop claiming new runs once this much wall-clock has elapsed. */
    budgetMs?: number;
    /** If set, stamp this tick id onto every row drained — lets the admin
     *  dashboard answer "which tick drained this row?" even when the row was
     *  enqueued by a different (earlier) tick. */
    tickId?: string;
    /** Dev-only: only claim pending runs for this user. Undefined = all users. */
    userId?: string;
  } = {},
): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  timedOut: boolean;
}> {
  const {
    limit = DEFAULT_DRAIN_LIMIT,
    concurrency = DEFAULT_DRAIN_CONCURRENCY,
    budgetMs = Number.POSITIVE_INFINITY,
    tickId,
    userId,
  } = opts;
  const startedAt = Date.now();
  resetFetchCacheStats();
  // Dev tooling can scope the drain to one user; default is all users. Either
  // way, apply the producer-first ordering so a capability that feeds another
  // drains ahead of its dependents this tick.
  const pending = sortPendingRunsProducerFirst(
    userId
      ? await connectorRunRepo.listPendingByUser(userId, limit)
      : await connectorRunRepo.listAllPending(limit),
  );

  let succeeded = 0;
  let failed = 0;
  let skipped = 0;

  const tally = (status: "succeeded" | "failed" | "skipped") => {
    if (status === "succeeded") succeeded++;
    else if (status === "failed") failed++;
    else skipped++;
  };

  // Two-tier drain: prerequisites/independent capabilities (tier 0) drain fully
  // before dependents (tier 1), so a capability that reads another's snapshot
  // finds fresh data THIS tick instead of soft-failing with MISSING_DEPENDENCY
  // and re-running fruitlessly next cadence. Dependents left unreached (budget
  // spent in tier 0) stay pending for the next tick — same durable-state
  // guarantee as the rest of the drain.
  const tier0 = pending.filter((r) => !isDependentCapability(r.capabilityKey));
  const tier1 = pending.filter((r) => isDependentCapability(r.capabilityKey));

  const t0 = await runDrainPool(tier0, {
    concurrency,
    startedAt,
    budgetMs,
    tickId,
    tally,
  });
  const t1 = await runDrainPool(tier1, {
    concurrency,
    startedAt,
    budgetMs,
    tickId,
    tally,
  });

  // `processed` is derived, not a separate counter — every claimed run lands in
  // exactly one of the three buckets, so this can't drift from them.
  const processed = succeeded + failed + skipped;
  log.info("fetch cache stats (this drain)", getFetchCacheStats());
  return {
    processed,
    succeeded,
    failed,
    skipped,
    timedOut: t0.timedOut || t1.timedOut,
  };
}

/**
 * A capability that reads another capability's snapshot.
 *
 * Sourced from the signal catalog — the same graph that drives provenance and
 * context assembly.
 */
function isDependentCapability(capabilityKey: string): boolean {
  return getCapabilityProducers(capabilityKey as CapabilityKey).length > 0;
}

/**
 * Execute a set of pending runs with bounded concurrency, sharing the drain's
 * wall-clock budget. Returns `timedOut: true` if any worker exited on the budget
 * guard rather than exhausting the queue.
 */
async function runDrainPool(
  runs: { id: string }[],
  opts: {
    concurrency: number;
    startedAt: number;
    budgetMs: number;
    tickId?: string;
    tally: (status: "succeeded" | "failed" | "skipped") => void;
  },
): Promise<{ timedOut: boolean }> {
  const { concurrency, startedAt, budgetMs, tickId, tally } = opts;
  let next = 0;
  let timedOut = false;

  async function worker(): Promise<void> {
    while (Date.now() - startedAt < budgetMs) {
      const run = runs[next++];
      if (!run) return; // queue exhausted
      try {
        tally((await executeConnectorRun(run.id, tickId)).status);
      } catch (err) {
        // `executeConnectorRun` guards its own body, but `markRunning` (the
        // claim) runs before that guard — a DB/network blip there throws past
        // it. Swallow per-run so one bad claim can't reject `Promise.all` and
        // discard every other worker's already-completed work (which would
        // 500 the whole tick and drop the telemetry tally).
        tally("failed");
        log.error("Drain worker errored on a run; counting as failed", {
          "run.id": run.id,
          "error.message": err instanceof Error ? err.message : String(err),
        });
      }
    }
    timedOut = true; // exited on the budget guard, not exhaustion
  }

  const workers = Array.from(
    { length: Math.min(concurrency, runs.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return { timedOut };
}

export type { ConnectorRun };
