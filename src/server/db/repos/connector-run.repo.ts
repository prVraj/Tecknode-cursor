import { and, desc, eq, lt, or, sql } from "drizzle-orm";
import { db } from "@/server/db";
import {
  type ConnectorRunOutput,
  type ConnectorRunStatus,
  connectorRuns,
  type NewConnectorRun,
} from "@/server/db/schema";

export const connectorRunRepo = {
  /**
   * Inserts a pending run. On conflict (idempotencyKey already exists for the
   * current window), returns null — caller treats that as "already queued / done".
   */
  enqueue: async (data: NewConnectorRun) => {
    const inserted = await db
      .insert(connectorRuns)
      .values(data)
      .onConflictDoNothing({ target: connectorRuns.idempotencyKey })
      .returning();
    return inserted[0] ?? null;
  },

  findById: (id: string) =>
    db
      .select()
      .from(connectorRuns)
      .where(eq(connectorRuns.id, id))
      .then((rows) => rows[0] ?? null),

  findByIdempotencyKey: (key: string) =>
    db
      .select()
      .from(connectorRuns)
      .where(eq(connectorRuns.idempotencyKey, key))
      .then((rows) => rows[0] ?? null),

  /**
   * Reclaim ghost runs: rows stuck in `running` whose `started_at` is older
   * than `olderThanMs`. Workers that died mid-execution (Vercel function
   * killed, hung upstream, deploy cut-over) leave the row in `running`
   * forever — and the daily idempotency key on (capability, entity, day)
   * blocks any fresh enqueue for that slot until tomorrow rolls over. This
   * sweep resets ghosts to `pending` so the next drain can re-run them.
   *
   * `olderThanMs` must comfortably exceed both the longest realistic single
   * run and the function's `maxDuration` so a concurrent, still-alive tick
   * is never robbed of a row it's legitimately executing.
   */
  reclaimStaleRunning: (olderThanMs: number) =>
    db
      .update(connectorRuns)
      .set({ status: "pending", startedAt: null })
      .where(
        and(
          eq(connectorRuns.status, "running"),
          lt(connectorRuns.startedAt, new Date(Date.now() - olderThanMs)),
        ),
      )
      .returning(),

  /** Atomic claim: SELECT ... FOR UPDATE SKIP LOCKED-style pattern. */
  markRunning: (id: string, tickId?: string | null) =>
    db
      .update(connectorRuns)
      .set({
        status: "running",
        startedAt: new Date(),
        // Stamp the draining tick onto the row so the dashboard can group by
        // "drained in this tick" even when the row was enqueued by an earlier
        // tick (idempotency-collapsed re-enqueues).
        ...(tickId ? { tickId } : {}),
      })
      .where(and(eq(connectorRuns.id, id), eq(connectorRuns.status, "pending")))
      .returning()
      .then((rows) => rows[0] ?? null),

  markSucceeded: (
    id: string,
    data: { output?: ConnectorRunOutput; costUnits?: number },
  ) =>
    db
      .update(connectorRuns)
      .set({
        status: "succeeded",
        finishedAt: new Date(),
        ...(data.output ? { output: data.output } : {}),
        ...(typeof data.costUnits === "number"
          ? { costUnits: data.costUnits.toString() }
          : {}),
      })
      .where(eq(connectorRuns.id, id))
      .returning()
      .then((rows) => rows[0] ?? null),

  markFailed: (
    id: string,
    data: { errorCode?: string; errorMessage: string },
  ) =>
    db
      .update(connectorRuns)
      .set({
        status: "failed",
        finishedAt: new Date(),
        errorCode: data.errorCode,
        errorMessage: data.errorMessage,
      })
      .where(eq(connectorRuns.id, id))
      .returning()
      .then((rows) => rows[0] ?? null),

  /** Reset a failed run back to pending so it can be retried. */
  resetToPending: (id: string) =>
    db
      .update(connectorRuns)
      .set({
        status: "pending",
        startedAt: null,
        finishedAt: null,
        errorCode: null,
        errorMessage: null,
        output: null,
      })
      .where(and(eq(connectorRuns.id, id), eq(connectorRuns.status, "failed")))
      .returning()
      .then((rows) => rows[0] ?? null),

  /** Force-reset any terminal run (failed or succeeded) back to pending for manual rerun. */
  forceResetToPending: (id: string) =>
    db
      .update(connectorRuns)
      .set({
        status: "pending",
        startedAt: null,
        finishedAt: null,
        errorCode: null,
        errorMessage: null,
        output: null,
      })
      .where(
        and(
          eq(connectorRuns.id, id),
          or(
            eq(connectorRuns.status, "failed"),
            eq(connectorRuns.status, "succeeded"),
          ),
        ),
      )
      .returning()
      .then((rows) => rows[0] ?? null),

  listPendingByUser: (userId: string, limit = 50) =>
    db
      .select()
      .from(connectorRuns)
      .where(
        and(
          eq(connectorRuns.userId, userId),
          eq(connectorRuns.status, "pending"),
        ),
      )
      // Oldest-first (FIFO), matching listAllPending — so a per-user backlog
      // beyond the limit drains in order instead of starving older rows.
      .orderBy(connectorRuns.createdAt)
      .limit(limit),

  listAllPending: (limit = 200) =>
    db
      .select()
      .from(connectorRuns)
      .where(eq(connectorRuns.status, "pending"))
      // Oldest-first so a persistent backlog drains FIFO. Without this, the
      // planner returns an arbitrary subset under the LIMIT and the oldest
      // pending rows starve once the backlog exceeds the drain limit — their
      // daily idempotency key then blocks re-enqueue until the day rolls over.
      // Served by `connector_runs_status_created_idx`.
      .orderBy(connectorRuns.createdAt)
      .limit(limit),

  /** Recent runs for one entity — used for per-capability run history on the signals page. */
  listByEntity: (entityId: string, limit = 100) =>
    db
      .select()
      .from(connectorRuns)
      .where(eq(connectorRuns.entityId, entityId))
      .orderBy(desc(connectorRuns.createdAt))
      .limit(limit),

  /**
   * Latest run per (entity, capability) for one user — status, error code, and
   * when it was created. Feeds the scheduler's re-enqueue guards: skip a slot
   * whose most recent run is too fresh (UTC-midnight double-enqueue) or which
   * failed non-retryably within a back-off window (connector circuit breaker).
   * DISTINCT ON keeps one row per slot; served by `connector_runs_user_idx`.
   */
  latestRunPerEntityCapability: (userId: string) =>
    db
      .selectDistinctOn([connectorRuns.entityId, connectorRuns.capabilityKey], {
        entityId: connectorRuns.entityId,
        capabilityKey: connectorRuns.capabilityKey,
        status: connectorRuns.status,
        errorCode: connectorRuns.errorCode,
        createdAt: connectorRuns.createdAt,
      })
      .from(connectorRuns)
      .where(eq(connectorRuns.userId, userId))
      .orderBy(
        connectorRuns.entityId,
        connectorRuns.capabilityKey,
        desc(connectorRuns.createdAt),
      ),

  countByUserStatus: (userId: string, status: ConnectorRunStatus) =>
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(connectorRuns)
      .where(
        and(eq(connectorRuns.userId, userId), eq(connectorRuns.status, status)),
      )
      .then((rows) => rows[0]?.count ?? 0),
};
