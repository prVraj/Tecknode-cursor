import { isNotNull } from "drizzle-orm";
import { sortCapabilitiesProducerFirst } from "@/lib/intel/capability-order";
import { userErrorFromCode } from "@/lib/intel/connector-errors";
import { buildIdempotencyKey, connectorKeyFor } from "@/lib/intel/keys";
import { db } from "@/server/db";
import { apiUsageRepo } from "@/server/db/repos/api-usage.repo";
import { connectorRunRepo } from "@/server/db/repos/connector-run.repo";
import { signalSnapshotRepo } from "@/server/db/repos/signal-snapshot.repo";
import { trackedEntityRepo } from "@/server/db/repos/tracked-entity.repo";
import {
  CAPABILITY_KEYS,
  CAPABILITY_META,
  type CapabilityKey,
  userIntelSettings,
} from "@/server/db/schema";
import logger from "@/utils/logger";

const log = logger.withContext({ module: "intel-scheduler" });

const MS_PER_DAY = 86_400_000;
/**
 * Grace window subtracted from the cadence comparison. Cron jitter + run
 * duration mean consecutive daily snapshots are typically ~23h59m apart, not
 * exactly 24h. Without a grace, a 23h59m elapsed time fails `< 1 day` and the
 * scheduler would skip — meaning "daily" signals would actually run every
 * OTHER day. One hour is generous enough to absorb cron drift, retries, and
 * function startup variance.
 */
const CADENCE_GRACE_MS = 3_600_000;

/**
 * Connector circuit breaker: after a run fails NON-retryably (bad OAuth,
 * exhausted quota, missing entity config — codes with `retryable: false`), skip
 * re-enqueuing that (entity, capability) for this long. Such a run re-fails
 * identically every tick, burning a paid run every day until someone
 * intervenes. Retryable failures (rate-limit, 5xx) are unaffected — they retry
 * on the next tick as before.
 */
const FAILURE_BACKOFF_MS = 3 * MS_PER_DAY;

/**
 * Platform-default per-user SOFT spend cap on paid connector APIs for the
 * current calendar month (UTC), in micro-USD. Overridable per user via
 * `user_intel_settings.cost_cap_micro_usd`. $25.00.
 *
 * Crossing the soft cap does NOT halt the user — it's logged, but signal
 * collection keeps running. RunAgents fired a founder Discord alert here
 * (`notifyFounderOps`); that alerting channel is out of scope for this
 * migration, so crossing the soft cap is log-only.
 */
const DEFAULT_USER_MONTHLY_BUDGET_MICRO_USD = BigInt(25_000_000);

/**
 * The HARD cap is `soft × this`. Only crossing it skips the user this cycle —
 * the backstop against a genuine runaway loop draining provider credits. Set
 * high enough that normal usage never reaches it; only a bug does.
 */
const HARD_CAP_MULTIPLIER = BigInt(4);

export interface EnqueueDailyResult {
  usersScanned: number;
  /** Users skipped because month-to-date connector spend reached their hard cap. */
  skippedOverBudget: number;
  entitiesScanned: number;
  enqueued: number;
  skippedAlreadyEnqueued: number;
  /** Skipped because last snapshot is younger than `CAPABILITY_META[k].cadenceDays`.
   *  Tracked separately from `skippedAlreadyEnqueued` so cost savings can be
   *  attributed to cadence vs. idempotency. */
  skippedByCadence: number;
  /** Skipped because `CAPABILITY_META[k].entityScope === "primary"` and the
   *  entity is a competitor. Brand-only signals shouldn't fan out across
   *  competitors. */
  skippedByEntityScope: number;
  /** Skipped because a run for this slot already exists within the cadence
   *  window (guards the UTC-midnight double-enqueue across two ticks). */
  skippedByRecentRun: number;
  /** Skipped by the connector circuit breaker — last run failed non-retryably
   *  within `FAILURE_BACKOFF_MS`. */
  skippedByFailureBackoff: number;
  /** Shared by every row inserted in this call. Returned so the caller can
   *  log it. */
  tickId: string;
}

type UserRow = {
  id: string;
  enabledCapabilities: Record<string, boolean> | null;
  costCapMicroUsd: bigint | null;
};

type LastRun = {
  status: string;
  errorCode: string | null;
  createdAt: Date;
};

/** Per-user tallies, summed into the top-level result. */
interface UserEnqueueCounts {
  entitiesScanned: number;
  enqueued: number;
  skippedAlreadyEnqueued: number;
  skippedByCadence: number;
  skippedByEntityScope: number;
  skippedByRecentRun: number;
  skippedByFailureBackoff: number;
}

function emptyCounts(): UserEnqueueCounts {
  return {
    entitiesScanned: 0,
    enqueued: 0,
    skippedAlreadyEnqueued: 0,
    skippedByCadence: 0,
    skippedByEntityScope: 0,
    skippedByRecentRun: 0,
    skippedByFailureBackoff: 0,
  };
}

/** Enabled capabilities for a user, filtered to known keys, producers first. */
function enabledCapabilitiesOf(userRow: UserRow): CapabilityKey[] {
  const keys = (
    Object.entries(userRow.enabledCapabilities ?? {}) as [string, unknown][]
  )
    .filter(([, v]) => v === true)
    .map(([k]) => k as CapabilityKey)
    .filter((k) => (CAPABILITY_KEYS as readonly string[]).includes(k));
  return sortCapabilitiesProducerFirst(keys);
}

interface BudgetStatus {
  spent: bigint;
  softCap: bigint;
  hardCap: bigint;
  /** Over soft cap → logged but keeps running. */
  overSoft: boolean;
  /** Over hard cap → skip the user this cycle. */
  overHard: boolean;
}

/** Month-to-date connector spend vs the user's soft and hard caps. */
async function checkUserBudget(
  userRow: UserRow,
  now: Date,
): Promise<BudgetStatus> {
  const softCap =
    userRow.costCapMicroUsd ?? DEFAULT_USER_MONTHLY_BUDGET_MICRO_USD;
  const hardCap = softCap * HARD_CAP_MULTIPLIER;
  const monthStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  );
  const spent = await apiUsageRepo.spendForUserSince(userRow.id, monthStart);
  return {
    spent,
    softCap,
    hardCap,
    overSoft: spent >= softCap,
    overHard: spent >= hardCap,
  };
}

const USD = (micro: bigint): string =>
  `$${(Number(micro) / 1_000_000).toFixed(2)}`;

/** Log that a user crossed their monthly soft budget (log-only; no external alert). */
function logSoftBudget(userId: string, budget: BudgetStatus): void {
  log.warn(
    budget.overHard ? "spend hard cap — user halted" : "spend soft cap crossed",
    {
      userId,
      spentUsd: USD(budget.spent),
      softCapUsd: USD(budget.softCap),
      hardCapUsd: USD(budget.hardCap),
    },
  );
}

/**
 * Whether a fresh enqueue for this slot should be skipped based on its most
 * recent run. `recent_run` guards the UTC-midnight double-enqueue; `backoff`
 * is the connector circuit breaker for non-retryable failures.
 */
function reEnqueueSkip(
  lastRun: LastRun | undefined,
  cadenceDays: number,
  nowMs: number,
): "recent_run" | "backoff" | null {
  if (!lastRun) return null;
  const ageMs = nowMs - lastRun.createdAt.getTime();
  if (ageMs < cadenceDays * MS_PER_DAY - CADENCE_GRACE_MS) return "recent_run";
  if (
    lastRun.status === "failed" &&
    !userErrorFromCode(lastRun.errorCode).retryable &&
    ageMs < FAILURE_BACKOFF_MS
  ) {
    return "backoff";
  }
  return null;
}

type SkipReason =
  | "skippedByEntityScope"
  | "skippedByCadence"
  | "skippedByRecentRun"
  | "skippedByFailureBackoff";

type SlotOutcome =
  | { action: "skip"; reason: SkipReason }
  | { action: "enqueue" };

/** Pure gate stack for one (entity, capability): entity-scope → cadence →
 *  midnight guard → circuit breaker. Returns whether to enqueue or why not. */
function decideSlot(params: {
  entity: { id: string; role: string };
  capability: CapabilityKey;
  lastSnapshots: Map<string, Date>;
  lastRuns: Map<string, LastRun>;
  nowMs: number;
}): SlotOutcome {
  const { entity, capability, lastSnapshots, lastRuns, nowMs } = params;
  const meta = CAPABILITY_META[capability];

  if (meta?.entityScope === "primary" && entity.role !== "primary") {
    return { action: "skip", reason: "skippedByEntityScope" };
  }

  const cadenceDays = meta?.cadenceDays ?? 1;
  const key = `${entity.id}:${capability}`;

  const last = lastSnapshots.get(key);
  if (
    last &&
    nowMs - last.getTime() < cadenceDays * MS_PER_DAY - CADENCE_GRACE_MS
  ) {
    return { action: "skip", reason: "skippedByCadence" };
  }

  const skip = reEnqueueSkip(lastRuns.get(key), cadenceDays, nowMs);
  if (skip === "recent_run") {
    return { action: "skip", reason: "skippedByRecentRun" };
  }
  if (skip === "backoff") {
    return { action: "skip", reason: "skippedByFailureBackoff" };
  }
  return { action: "enqueue" };
}

/**
 * Enqueue every due (entity, capability) pending run for one user. Assumes the
 * caller has already applied the user-level budget gate.
 */
async function enqueueForUser(
  userRow: UserRow,
  now: Date,
  tickId: string,
): Promise<UserEnqueueCounts> {
  const counts = emptyCounts();
  const entities = await trackedEntityRepo.listByUser(userRow.id);
  if (entities.length === 0) return counts;

  const enabled = enabledCapabilitiesOf(userRow);
  // Two bulk queries per user: last snapshot (cadence gate) and last run
  // (midnight guard + circuit breaker) per (entity, capability).
  const [lastSnapshots, lastRunRows] = await Promise.all([
    signalSnapshotRepo.latestCapturedAtPerEntityCapability(userRow.id),
    connectorRunRepo.latestRunPerEntityCapability(userRow.id),
  ]);
  const lastRuns = new Map<string, LastRun>(
    lastRunRows.map((r) => [`${r.entityId}:${r.capabilityKey}`, r]),
  );

  const nowMs = now.getTime();
  for (const entity of entities) {
    counts.entitiesScanned++;
    for (const capability of enabled) {
      const outcome = decideSlot({
        entity,
        capability,
        lastSnapshots,
        lastRuns,
        nowMs,
      });
      if (outcome.action === "skip") {
        counts[outcome.reason]++;
        continue;
      }

      const inserted = await connectorRunRepo.enqueue({
        userId: userRow.id,
        entityId: entity.id,
        capabilityKey: capability,
        connectorKey: connectorKeyFor(capability),
        status: "pending",
        tickId,
        idempotencyKey: buildIdempotencyKey(capability, entity.id, now),
      });
      if (inserted) counts.enqueued++;
      else counts.skippedAlreadyEnqueued++;
    }
  }
  return counts;
}

/**
 * Daily scheduler: for every user with intel settings, for every tracked
 * entity, for every enabled capability — insert a pending `connector_runs`
 * row. Postgres unique constraint on `idempotencyKey` collapses duplicates
 * within the day bucket.
 *
 * Caller may pass an explicit `tickId` to share it across pre-tick work (e.g.
 * the runner reads it from its context); omitted = generate a fresh UUID.
 */
export async function enqueueDailyRuns(
  now = new Date(),
  tickId: string = crypto.randomUUID(),
  // Dev-only: scope the tick to a single user. Undefined = all users (cron default).
  userId?: string,
): Promise<EnqueueDailyResult> {
  const users = await db
    .select({
      id: userIntelSettings.userId,
      enabledCapabilities: userIntelSettings.enabledCapabilities,
      costCapMicroUsd: userIntelSettings.costCapMicroUsd,
    })
    .from(userIntelSettings)
    .where(isNotNull(userIntelSettings.enabledCapabilities));

  const scoped = userId ? users.filter((u) => u.id === userId) : users;

  const totals = emptyCounts();
  let skippedOverBudget = 0;

  for (const userRow of scoped) {
    // Two-tier spend guard. Soft cap: log but keep collecting. Hard cap: skip
    // — the backstop against a genuine runaway loop draining credits.
    const budget = await checkUserBudget(userRow, now);
    if (budget.overSoft) {
      logSoftBudget(userRow.id, budget);
    }
    if (budget.overHard) {
      skippedOverBudget++;
      continue;
    }

    addCounts(totals, await enqueueForUser(userRow, now, tickId));
  }

  return {
    usersScanned: scoped.length,
    skippedOverBudget,
    ...totals,
    tickId,
  };
}

/** Accumulate one user's tallies into the running totals. */
function addCounts(totals: UserEnqueueCounts, one: UserEnqueueCounts): void {
  totals.entitiesScanned += one.entitiesScanned;
  totals.enqueued += one.enqueued;
  totals.skippedAlreadyEnqueued += one.skippedAlreadyEnqueued;
  totals.skippedByCadence += one.skippedByCadence;
  totals.skippedByEntityScope += one.skippedByEntityScope;
  totals.skippedByRecentRun += one.skippedByRecentRun;
  totals.skippedByFailureBackoff += one.skippedByFailureBackoff;
}
