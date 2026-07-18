import { and, count, desc, eq, gte, lt, sql, sum } from "drizzle-orm";
import { db } from "@/server/db";
import {
  type ApiUsageProvider,
  apiUsageEvents,
  connectorRuns,
} from "@/server/db/schema";

export interface UsageRange {
  from: Date;
  to: Date;
}

/** Headline KPI numbers for the date range. */
export interface UsageTotals {
  calls: number;
  errors: number;
  costMicroUsd: bigint;
}

/** One bar in the stacked "spend per provider per day" chart. */
export interface DailyProviderSpendRow {
  day: string; // YYYY-MM-DD
  provider: ApiUsageProvider;
  calls: number;
  errors: number;
  costMicroUsd: bigint;
}

/** Per-capability rollup row for the table view. */
export interface CapabilityRollupRow {
  capabilityKey: string | null;
  provider: ApiUsageProvider;
  calls: number;
  errors: number;
  costMicroUsd: bigint;
}

export const apiUsageRepo = {
  /** Aggregate every call in the range into one totals row. */
  totals: async (range: UsageRange): Promise<UsageTotals> => {
    const rows = await db
      .select({
        calls: count(),
        errors: sql<number>`count(*) filter (where ${apiUsageEvents.status} = 'error')`,
        costMicroUsd: sql<string>`coalesce(sum(${apiUsageEvents.costMicroUsd}), 0)`,
      })
      .from(apiUsageEvents)
      .where(
        and(
          gte(apiUsageEvents.createdAt, range.from),
          lt(apiUsageEvents.createdAt, range.to),
        ),
      );
    const row = rows[0];
    return {
      calls: row ? Number(row.calls) : 0,
      errors: row ? Number(row.errors) : 0,
      costMicroUsd: row ? BigInt(row.costMicroUsd) : BigInt(0),
    };
  },

  /** Daily totals per provider — feeds the stacked bar chart. */
  dailyByProvider: async (
    range: UsageRange,
  ): Promise<DailyProviderSpendRow[]> => {
    const rows = await db
      .select({
        day: sql<string>`to_char(${apiUsageEvents.createdAt}, 'YYYY-MM-DD')`,
        provider: apiUsageEvents.provider,
        calls: count(),
        errors: sql<number>`count(*) filter (where ${apiUsageEvents.status} = 'error')`,
        costMicroUsd: sql<string>`coalesce(sum(${apiUsageEvents.costMicroUsd}), 0)`,
      })
      .from(apiUsageEvents)
      .where(
        and(
          gte(apiUsageEvents.createdAt, range.from),
          lt(apiUsageEvents.createdAt, range.to),
        ),
      )
      .groupBy(
        sql`to_char(${apiUsageEvents.createdAt}, 'YYYY-MM-DD')`,
        apiUsageEvents.provider,
      )
      .orderBy(sql`to_char(${apiUsageEvents.createdAt}, 'YYYY-MM-DD')`);

    return rows.map((r) => ({
      day: r.day,
      provider: r.provider,
      calls: Number(r.calls),
      errors: Number(r.errors),
      costMicroUsd: BigInt(r.costMicroUsd),
    }));
  },

  /** Top N capabilities by cost in the range — feeds the table on the dashboard. */
  byCapability: async (
    range: UsageRange,
    limit = 50,
  ): Promise<CapabilityRollupRow[]> => {
    const rows = await db
      .select({
        capabilityKey: apiUsageEvents.capabilityKey,
        provider: apiUsageEvents.provider,
        calls: count(),
        errors: sql<number>`count(*) filter (where ${apiUsageEvents.status} = 'error')`,
        costMicroUsd: sql<string>`coalesce(sum(${apiUsageEvents.costMicroUsd}), 0)`,
      })
      .from(apiUsageEvents)
      .where(
        and(
          gte(apiUsageEvents.createdAt, range.from),
          lt(apiUsageEvents.createdAt, range.to),
        ),
      )
      .groupBy(apiUsageEvents.capabilityKey, apiUsageEvents.provider)
      .orderBy(desc(sum(apiUsageEvents.costMicroUsd)))
      .limit(limit);

    return rows.map((r) => ({
      capabilityKey: r.capabilityKey,
      provider: r.provider,
      calls: Number(r.calls),
      errors: Number(r.errors),
      costMicroUsd: BigInt(r.costMicroUsd),
    }));
  },

  /**
   * Total connector spend (micro-USD) attributed to one user since `since`.
   * Drives the daily scheduler's per-user budget cutoff. Served by
   * `api_usage_user_created_at_idx` (userId, createdAt).
   */
  spendForUserSince: async (userId: string, since: Date): Promise<bigint> => {
    const rows = await db
      .select({
        costMicroUsd: sql<string>`coalesce(sum(${apiUsageEvents.costMicroUsd}), 0)`,
      })
      .from(apiUsageEvents)
      .where(
        and(
          eq(apiUsageEvents.userId, userId),
          gte(apiUsageEvents.createdAt, since),
        ),
      );
    return rows[0] ? BigInt(rows[0].costMicroUsd) : BigInt(0);
  },

  /** All events for a specific run — drill-down view. */
  byRunId: (runId: string) =>
    db
      .select()
      .from(apiUsageEvents)
      .where(eq(apiUsageEvents.runId, runId))
      .orderBy(desc(apiUsageEvents.createdAt)),

  /** All connector runs that share a tickId — drill-down view. */
  runsForTick: (tickId: string) =>
    db
      .select()
      .from(connectorRuns)
      .where(eq(connectorRuns.tickId, tickId))
      .orderBy(desc(connectorRuns.createdAt)),

  /**
   * Hierarchical breakdown for one tick: rows of (user, capability) with run
   * counts, API call counts, and cost. Drives the "which capabilities ran for
   * which user and at what cost" view on the tick detail page.
   *
   * LEFT JOIN to user so deleted users still appear as their id.
   * LEFT JOIN to api_usage_events so capabilities that ran but didn't make any
   * tracked API calls still show (count=0 cost=0) instead of vanishing.
   */
  tickBreakdownByUserAndCapability: async (
    tickId: string,
  ): Promise<
    {
      userId: string;
      userName: string | null;
      capabilityKey: string;
      runs: number;
      succeeded: number;
      failed: number;
      pending: number;
      apiCalls: number;
      apiErrors: number;
      costMicroUsd: bigint;
    }[]
  > => {
    const { user } = await import("@/server/db/schema");
    const rows = await db
      .select({
        userId: connectorRuns.userId,
        userName: user.name,
        capabilityKey: connectorRuns.capabilityKey,
        runs: sql<number>`count(distinct ${connectorRuns.id})`,
        succeeded: sql<number>`count(distinct ${connectorRuns.id}) filter (where ${connectorRuns.status} = 'succeeded')`,
        failed: sql<number>`count(distinct ${connectorRuns.id}) filter (where ${connectorRuns.status} = 'failed')`,
        pending: sql<number>`count(distinct ${connectorRuns.id}) filter (where ${connectorRuns.status} = 'pending')`,
        apiCalls: count(apiUsageEvents.id),
        apiErrors: sql<number>`count(${apiUsageEvents.id}) filter (where ${apiUsageEvents.status} = 'error')`,
        costMicroUsd: sql<string>`coalesce(sum(${apiUsageEvents.costMicroUsd}), 0)`,
      })
      .from(connectorRuns)
      .leftJoin(user, eq(connectorRuns.userId, user.id))
      .leftJoin(apiUsageEvents, eq(apiUsageEvents.runId, connectorRuns.id))
      .where(eq(connectorRuns.tickId, tickId))
      .groupBy(connectorRuns.userId, user.name, connectorRuns.capabilityKey)
      .orderBy(desc(sql`coalesce(sum(${apiUsageEvents.costMicroUsd}), 0)`));

    return rows.map((r) => ({
      userId: r.userId,
      userName: r.userName,
      capabilityKey: r.capabilityKey,
      runs: Number(r.runs),
      succeeded: Number(r.succeeded),
      failed: Number(r.failed),
      pending: Number(r.pending),
      apiCalls: Number(r.apiCalls),
      apiErrors: Number(r.apiErrors),
      costMicroUsd: BigInt(r.costMicroUsd),
    }));
  },

  /** Aggregated api_usage stats for a single tick. */
  tickTotals: async (
    tickId: string,
  ): Promise<{ apiCalls: number; apiErrors: number; costMicroUsd: bigint }> => {
    const rows = await db
      .select({
        apiCalls: count(apiUsageEvents.id),
        apiErrors: sql<number>`count(*) filter (where ${apiUsageEvents.status} = 'error')`,
        costMicroUsd: sql<string>`coalesce(sum(${apiUsageEvents.costMicroUsd}), 0)`,
      })
      .from(apiUsageEvents)
      .innerJoin(connectorRuns, eq(apiUsageEvents.runId, connectorRuns.id))
      .where(eq(connectorRuns.tickId, tickId));
    const r = rows[0];
    return {
      apiCalls: r ? Number(r.apiCalls) : 0,
      apiErrors: r ? Number(r.apiErrors) : 0,
      costMicroUsd: r ? BigInt(r.costMicroUsd) : BigInt(0),
    };
  },
};
