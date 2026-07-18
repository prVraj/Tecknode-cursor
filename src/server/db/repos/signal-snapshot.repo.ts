import { and, desc, eq, inArray, isNotNull, lt, max } from "drizzle-orm";
import {
  type SnapshotProvenance,
  unwrapSnapshotPayload,
  unwrapSnapshotProvenance,
} from "@/lib/intel/provenance";
import { db } from "@/server/db";
import {
  type CapabilityKey,
  type NewSignalSnapshot,
  type ScoreDirection,
  type SignalCategory,
  type SignalSnapshot,
  signalSnapshots,
  trackedEntities,
} from "@/server/db/schema";

export type SignalSnapshotRead = SignalSnapshot & {
  /** Present when the stored row used a `{ data, provenance }` envelope. */
  snapshotProvenance: SnapshotProvenance | null;
};

function normalizeSnapshotRead(row: SignalSnapshot): SignalSnapshotRead {
  return {
    ...row,
    payload: unwrapSnapshotPayload(row.payload),
    snapshotProvenance: unwrapSnapshotProvenance(row.payload),
  };
}

export type SignalSnapshotHistoryLite = {
  capturedDate: string;
  primaryScore: string | null;
  capabilityKey: CapabilityKey;
  hasDataIssues: boolean;
  scoreDirection: ScoreDirection | null;
};

export const signalSnapshotRepo = {
  /**
   * Upsert by the daily unique constraint (entityId, capabilityKey, capturedDate).
   * Replaces payload + primaryScore if a snapshot already exists for that day.
   */
  upsert: async (data: NewSignalSnapshot): Promise<SignalSnapshot> =>
    db
      .insert(signalSnapshots)
      .values(data)
      .onConflictDoUpdate({
        target: [
          signalSnapshots.entityId,
          signalSnapshots.capabilityKey,
          signalSnapshots.capturedDate,
        ],
        set: {
          primaryScore: data.primaryScore,
          scoreDirection: data.scoreDirection,
          payload: data.payload,
          hasDataIssues: data.hasDataIssues,
          capturedAt: data.capturedAt ?? new Date(),
          runId: data.runId,
        },
      })
      .returning()
      .then((rows) => rows[0]!),

  /**
   * Latest snapshot strictly before `beforeDate` (YYYY-MM-DD), trustworthy or
   * not — for content diffing (e.g. `geo_citation_velocity`), which wants the
   * immediately-prior *payload* regardless of score quality.
   *
   * Not for score comparison: use {@link findPreviousScored}.
   */
  findPrevious: (
    entityId: string,
    capabilityKey: CapabilityKey,
    beforeDate: string,
  ): Promise<SignalSnapshotRead | null> =>
    db
      .select()
      .from(signalSnapshots)
      .where(
        and(
          eq(signalSnapshots.entityId, entityId),
          eq(signalSnapshots.capabilityKey, capabilityKey),
          lt(signalSnapshots.capturedDate, beforeDate),
        ),
      )
      .orderBy(desc(signalSnapshots.capturedDate))
      .limit(1)
      .then((rows) => (rows[0] ? normalizeSnapshotRead(rows[0]) : null)),

  /**
   * Latest *trustworthy scored* snapshot strictly before `beforeDate` — the
   * baseline for day-over-day score deltas.
   *
   * A degraded run persists `primaryScore: null, hasDataIssues: true` (see
   * `persistSnapshotAndScoreDelta`). Selecting it as the comparison baseline
   * silently suppresses the next clean run's signal: the caller sees a non-null
   * `prior` so it skips the baseline branch, then sees `prior.primaryScore ==
   * null` so it skips the delta branch too. A real regression the day after a
   * flaky run would emit nothing. Skipping degraded and unscored rows here
   * means `prior` is always a usable comparison point, or absent.
   */
  findPreviousScored: (
    entityId: string,
    capabilityKey: CapabilityKey,
    beforeDate: string,
  ): Promise<SignalSnapshot | null> =>
    db
      .select()
      .from(signalSnapshots)
      .where(
        and(
          eq(signalSnapshots.entityId, entityId),
          eq(signalSnapshots.capabilityKey, capabilityKey),
          lt(signalSnapshots.capturedDate, beforeDate),
          eq(signalSnapshots.hasDataIssues, false),
          isNotNull(signalSnapshots.primaryScore),
        ),
      )
      .orderBy(desc(signalSnapshots.capturedDate))
      .limit(1)
      .then((rows) => rows[0] ?? null),

  /** Latest snapshot for a single (entity, capability) — used for current-state cards. */
  findLatest: (
    entityId: string,
    capabilityKey: CapabilityKey,
  ): Promise<SignalSnapshotRead | null> =>
    db
      .select()
      .from(signalSnapshots)
      .where(
        and(
          eq(signalSnapshots.entityId, entityId),
          eq(signalSnapshots.capabilityKey, capabilityKey),
        ),
      )
      .orderBy(desc(signalSnapshots.capturedDate))
      .limit(1)
      .then((rows) => (rows[0] ? normalizeSnapshotRead(rows[0]) : null)),

  /**
   * Latest snapshot for (entity, capability) scoped to a user — full payload.
   * Returns null when the entity doesn't belong to the user.
   */
  findLatestForUser: async (
    userId: string,
    entityId: string,
    capabilityKey: CapabilityKey,
  ): Promise<SignalSnapshotRead | null> => {
    const entity = await db
      .select({ id: trackedEntities.id })
      .from(trackedEntities)
      .where(
        and(
          eq(trackedEntities.id, entityId),
          eq(trackedEntities.userId, userId),
        ),
      )
      .limit(1)
      .then((rows) => rows[0] ?? null);

    if (!entity) return null;

    return db
      .select()
      .from(signalSnapshots)
      .where(
        and(
          eq(signalSnapshots.userId, userId),
          eq(signalSnapshots.entityId, entityId),
          eq(signalSnapshots.capabilityKey, capabilityKey),
        ),
      )
      .orderBy(desc(signalSnapshots.capturedDate))
      .limit(1)
      .then((rows) => (rows[0] ? normalizeSnapshotRead(rows[0]) : null));
  },

  /**
   * Time-series history for sparklines and trend charts.
   * Returns rows oldest-first so the caller can plot directly.
   */
  listHistory: (
    entityId: string,
    capabilityKey: CapabilityKey,
    limit = 30,
  ): Promise<SignalSnapshotRead[]> =>
    db
      .select()
      .from(signalSnapshots)
      .where(
        and(
          eq(signalSnapshots.entityId, entityId),
          eq(signalSnapshots.capabilityKey, capabilityKey),
        ),
      )
      .orderBy(desc(signalSnapshots.capturedDate))
      .limit(limit)
      .then((rows) => rows.reverse().map(normalizeSnapshotRead)),

  /**
   * Time-series history scoped to a user-owned entity.
   * Returns null when the entity is missing or not owned by the user.
   */
  listHistoryForUser: async (
    userId: string,
    entityId: string,
    capabilityKey?: CapabilityKey,
    limit = 14,
  ): Promise<SignalSnapshotHistoryLite[] | null> => {
    const entity = await db
      .select({ id: trackedEntities.id })
      .from(trackedEntities)
      .where(
        and(
          eq(trackedEntities.id, entityId),
          eq(trackedEntities.userId, userId),
        ),
      )
      .limit(1)
      .then((rows) => rows[0] ?? null);

    if (!entity) return null;

    const filters = [
      eq(signalSnapshots.userId, userId),
      eq(signalSnapshots.entityId, entityId),
    ];
    if (capabilityKey) {
      filters.push(eq(signalSnapshots.capabilityKey, capabilityKey));
    }

    return db
      .select({
        capturedDate: signalSnapshots.capturedDate,
        primaryScore: signalSnapshots.primaryScore,
        capabilityKey: signalSnapshots.capabilityKey,
        hasDataIssues: signalSnapshots.hasDataIssues,
        scoreDirection: signalSnapshots.scoreDirection,
      })
      .from(signalSnapshots)
      .where(and(...filters))
      .orderBy(desc(signalSnapshots.capturedDate))
      .limit(limit);
  },

  /** All latest snapshots for an entity, grouped by capability — for the dashboard overview. */
  listLatestByEntity: (entityId: string): Promise<SignalSnapshotRead[]> =>
    db
      .select()
      .from(signalSnapshots)
      .where(eq(signalSnapshots.entityId, entityId))
      .orderBy(
        signalSnapshots.capabilityKey,
        desc(signalSnapshots.capturedDate),
      )
      .then((rows) => rows.map(normalizeSnapshotRead)),

  /** Latest snapshots for multiple entities in one query — avoids N+1 in picker catalog. */
  listLatestByEntities: (
    userId: string,
    entityIds: string[],
  ): Promise<SignalSnapshotRead[]> => {
    if (entityIds.length === 0) return Promise.resolve([]);

    return db
      .select()
      .from(signalSnapshots)
      .where(
        and(
          eq(signalSnapshots.userId, userId),
          inArray(signalSnapshots.entityId, entityIds),
        ),
      )
      .orderBy(
        signalSnapshots.entityId,
        signalSnapshots.capabilityKey,
        desc(signalSnapshots.capturedDate),
      )
      .then((rows) => rows.map(normalizeSnapshotRead));
  },

  /**
   * For one user, latest captured_at per (entityId, capabilityKey). One bulk query
   * — relies on the existing `signal_snapshots_entity_cap_idx` index. Used by
   * the scheduler to decide whether a (entity, capability) is due for a fresh
   * fetch given its `CAPABILITY_META[k].cadenceDays` window.
   *
   * Returns a Map keyed by `${entityId}:${capabilityKey}` for O(1) lookup
   * inside the scheduler's nested loop.
   */
  latestCapturedAtPerEntityCapability: async (
    userId: string,
  ): Promise<Map<string, Date>> => {
    const rows = await db
      .select({
        entityId: signalSnapshots.entityId,
        capabilityKey: signalSnapshots.capabilityKey,
        lastCapturedAt: max(signalSnapshots.capturedAt),
      })
      .from(signalSnapshots)
      .where(eq(signalSnapshots.userId, userId))
      .groupBy(signalSnapshots.entityId, signalSnapshots.capabilityKey);

    const out = new Map<string, Date>();
    for (const r of rows) {
      if (r.lastCapturedAt) {
        // Some drivers / serverless adapters return aggregate results as ISO
        // strings even when the column type is timestamp. Coerce defensively
        // so the scheduler can always call `.getTime()` on the value.
        out.set(
          `${r.entityId}:${r.capabilityKey}`,
          r.lastCapturedAt instanceof Date
            ? r.lastCapturedAt
            : new Date(r.lastCapturedAt),
        );
      }
    }
    return out;
  },

  /** All snapshots in a category for a user — for category tab views. Optionally scoped to one entity. */
  listByUserCategory: (
    userId: string,
    category: SignalCategory,
    entityId?: string,
    limit = 200,
  ): Promise<SignalSnapshotRead[]> => {
    const conditions = [
      eq(signalSnapshots.userId, userId),
      eq(signalSnapshots.category, category),
    ];
    if (entityId) conditions.push(eq(signalSnapshots.entityId, entityId));
    return db
      .select()
      .from(signalSnapshots)
      .where(and(...conditions))
      .orderBy(desc(signalSnapshots.capturedDate))
      .limit(limit)
      .then((rows) => rows.map(normalizeSnapshotRead));
  },
};
