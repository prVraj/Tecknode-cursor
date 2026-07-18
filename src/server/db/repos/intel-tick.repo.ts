import { and, count, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "@/server/db";
import {
  apiUsageEvents,
  connectorRuns,
  type IntelTickSource,
  intelTicks,
  type NewIntelTick,
} from "@/server/db/schema";

export const intelTickRepo = {
  /** Insert a tick row at the start of every cron/manual invocation. Returns
   *  the row so the caller can keep its id (UUID) handy for updates. */
  start: (data: { source: IntelTickSource; triggerUserId?: string | null }) =>
    db
      .insert(intelTicks)
      .values({
        source: data.source,
        triggerUserId: data.triggerUserId ?? null,
      } satisfies NewIntelTick)
      .returning()
      .then((rows) => rows[0]),

  /** Update the tick row at end-of-tick with all the captured stats. */
  finish: (id: string, stats: Partial<typeof intelTicks.$inferInsert>) =>
    db
      .update(intelTicks)
      .set({ ...stats, finishedAt: new Date() })
      .where(eq(intelTicks.id, id))
      .returning()
      .then((rows) => rows[0] ?? null),

  findById: (id: string) =>
    db
      .select()
      .from(intelTicks)
      .where(eq(intelTicks.id, id))
      .then((rows) => rows[0] ?? null),

  /**
   * Newest tick of a given source that actually *completed* (heartbeat).
   * Filters on `finishedAt` rather than taking the newest row: a tick that
   * started and then died leaves a fresh `startedAt` and a null `finishedAt`,
   * so keying off `startedAt` would report the pipeline healthy at the exact
   * moment it stopped finishing.
   */
  findLastFinished: (source: IntelTickSource) =>
    db
      .select()
      .from(intelTicks)
      .where(
        and(eq(intelTicks.source, source), isNotNull(intelTicks.finishedAt)),
      )
      .orderBy(desc(intelTicks.finishedAt))
      .limit(1)
      .then((rows) => rows[0] ?? null),

  /** Paginated newest-first list of every tick. */
  list: async (opts: { limit?: number; offset?: number }) => {
    const limit = Math.min(opts.limit ?? 50, 200);
    const offset = Math.max(opts.offset ?? 0, 0);
    return db
      .select()
      .from(intelTicks)
      .orderBy(desc(intelTicks.startedAt))
      .limit(limit)
      .offset(offset);
  },

  /** Total tick count for pagination. */
  count: async () => {
    const [row] = await db.select({ value: count() }).from(intelTicks);
    return row?.value ?? 0;
  },

  /** Aggregated api_usage cost per tick (in micro-USD), keyed by tickId. Used
   *  by the list page to annotate each row with $ without N+1 queries. */
  costsForTicks: async (
    tickIds: string[],
  ): Promise<Map<string, { apiCalls: number; costMicroUsd: bigint }>> => {
    const out = new Map<string, { apiCalls: number; costMicroUsd: bigint }>();
    if (tickIds.length === 0) return out;
    const rows = await db
      .select({
        tickId: connectorRuns.tickId,
        apiCalls: count(apiUsageEvents.id),
        costMicroUsd: sql<string>`coalesce(sum(${apiUsageEvents.costMicroUsd}), 0)`,
      })
      .from(apiUsageEvents)
      .innerJoin(connectorRuns, eq(apiUsageEvents.runId, connectorRuns.id))
      .where(inArray(connectorRuns.tickId, tickIds))
      .groupBy(connectorRuns.tickId);
    for (const r of rows) {
      if (r.tickId) {
        out.set(r.tickId, {
          apiCalls: Number(r.apiCalls),
          costMicroUsd: BigInt(r.costMicroUsd),
        });
      }
    }
    return out;
  },
};
