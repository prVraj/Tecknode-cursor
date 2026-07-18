import type { SQL } from "drizzle-orm";
import { and, between, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/server/db";
import {
  type CapabilityKey,
  type NewSignal,
  type Signal,
  type SignalSeverity,
  signals,
} from "@/server/db/schema";

export interface SignalSearchFilters {
  userId: string;
  entityIds?: string[];
  capabilityKey?: CapabilityKey;
  severities?: SignalSeverity[];
  since?: Date;
  until?: Date;
  /** Substring match against title/summary — case-insensitive. */
  query?: string;
  /** Hard cap. Server enforces ≤ 50. */
  limit?: number;
}

const HARD_LIMIT = 50;

function buildFilters(f: SignalSearchFilters): SQL[] {
  const where: SQL[] = [eq(signals.userId, f.userId)];
  if (f.entityIds && f.entityIds.length > 0) {
    where.push(inArray(signals.subjectEntityId, f.entityIds));
  }
  if (f.capabilityKey) {
    where.push(eq(signals.capabilityKey, f.capabilityKey));
  }
  if (f.severities && f.severities.length > 0) {
    where.push(inArray(signals.severity, f.severities));
  }
  if (f.since && f.until) {
    where.push(between(signals.lastSeenAt, f.since, f.until));
  } else if (f.since) {
    where.push(gte(signals.lastSeenAt, f.since));
  } else if (f.until) {
    where.push(lte(signals.lastSeenAt, f.until));
  }
  if (f.query?.trim()) {
    const pattern = `%${f.query.trim().replace(/[%_]/g, (m) => `\\${m}`)}%`;
    where.push(
      sql`(${signals.title} ILIKE ${pattern} OR ${signals.summary} ILIKE ${pattern})`,
    );
  }
  return where;
}

export const signalRepo = {
  /**
   * Upsert by stable dedupKey. If a signal with the same dedupKey exists,
   * bumps `lastSeenAt` and rotates evidence to the latest run. Otherwise
   * inserts a new row.
   */
  upsertByDedupKey: (data: NewSignal): Promise<Signal> =>
    db
      .insert(signals)
      .values(data)
      .onConflictDoUpdate({
        target: signals.dedupKey,
        set: {
          lastSeenAt: new Date(),
          evidence: data.evidence,
          severity: data.severity,
          title: data.title,
          summary: data.summary,
          confidence: data.confidence,
        },
      })
      .returning()
      .then((rows) => rows[0]!),

  findById: (id: string, userId: string): Promise<Signal | null> =>
    db
      .select()
      .from(signals)
      .where(and(eq(signals.id, id), eq(signals.userId, userId)))
      .then((rows) => rows[0] ?? null),

  listByIds: (ids: string[], userId: string): Promise<Signal[]> => {
    if (ids.length === 0) return Promise.resolve([]);
    return db
      .select()
      .from(signals)
      .where(and(inArray(signals.id, ids), eq(signals.userId, userId)));
  },

  search: (filters: SignalSearchFilters): Promise<Signal[]> => {
    const limit = Math.min(filters.limit ?? 20, HARD_LIMIT);
    const where = buildFilters(filters);
    return db
      .select()
      .from(signals)
      .where(and(...where))
      .orderBy(desc(signals.lastSeenAt))
      .limit(limit);
  },

  listByUser: (
    userId: string,
    opts: { since?: Date; entityId?: string; limit?: number } = {},
  ) => {
    const conditions = [eq(signals.userId, userId)];
    if (opts.since) conditions.push(gte(signals.lastSeenAt, opts.since));
    if (opts.entityId)
      conditions.push(eq(signals.subjectEntityId, opts.entityId));

    return db
      .select()
      .from(signals)
      .where(and(...conditions))
      .orderBy(desc(signals.lastSeenAt))
      .limit(opts.limit ?? 100);
  },

  countByUser: (userId: string, since?: Date) => {
    const conditions = [eq(signals.userId, userId)];
    if (since) conditions.push(gte(signals.lastSeenAt, since));
    return db
      .select({ count: sql<number>`count(*)::int` })
      .from(signals)
      .where(and(...conditions))
      .then((rows) => rows[0]?.count ?? 0);
  },

  findByDedupKey: (dedupKey: string) =>
    db
      .select()
      .from(signals)
      .where(eq(signals.dedupKey, dedupKey))
      .then((rows) => rows[0] ?? null),

  listByCapability: (
    userId: string,
    capabilityKey: CapabilityKey,
    limit = 50,
  ) =>
    db
      .select()
      .from(signals)
      .where(
        and(
          eq(signals.userId, userId),
          eq(signals.capabilityKey, capabilityKey),
        ),
      )
      .orderBy(desc(signals.lastSeenAt))
      .limit(limit),

  listFirehoseByUser: (
    userId: string,
    opts: { entityId?: string; limit?: number } = {},
  ) => {
    const conditions = [
      eq(signals.userId, userId),
      sql`${signals.evidence} -> 'details' ->> 'provider' = 'firehose'`,
    ];
    if (opts.entityId) {
      conditions.push(eq(signals.subjectEntityId, opts.entityId));
    }

    return db
      .select()
      .from(signals)
      .where(and(...conditions))
      .orderBy(desc(signals.lastSeenAt))
      .limit(opts.limit ?? 25);
  },

  /** Used by the daily digest — last-N-hours signals, severity-ordered. */
  /**
   * Signals for ONE entity across a set of capabilities, seen since `since`.
   * Backs the `seo_site_health` composite (issue #386), which rolls up the
   * technical SEO signals rather than re-deriving them from six payload shapes.
   *
   * Filters on `lastSeenAt`, not `createdAt`: a signal first raised weeks ago
   * but still being re-seen every run is a still-open issue and must keep
   * counting against health, while one that stopped recurring drops out of the
   * window on its own — which is what "fixed" looks like here.
   */
  listByEntityCapabilitiesSince: (
    entityId: string,
    capabilityKeys: readonly CapabilityKey[],
    since: Date,
  ): Promise<Signal[]> => {
    if (capabilityKeys.length === 0) return Promise.resolve([]);
    return db
      .select()
      .from(signals)
      .where(
        and(
          eq(signals.subjectEntityId, entityId),
          inArray(signals.capabilityKey, [...capabilityKeys]),
          gte(signals.lastSeenAt, since),
        ),
      )
      .orderBy(desc(signals.lastSeenAt));
  },

  listByUserInWindow: (
    userId: string,
    since: Date,
    until: Date,
    limit = 100,
  ): Promise<Signal[]> =>
    db
      .select()
      .from(signals)
      .where(
        and(
          eq(signals.userId, userId),
          between(signals.lastSeenAt, since, until),
        ),
      )
      .orderBy(
        sql`CASE ${signals.severity}
              WHEN 'p0' THEN 0
              WHEN 'p1' THEN 1
              WHEN 'p2' THEN 2
              ELSE 3 END`,
        desc(signals.lastSeenAt),
      )
      .limit(limit),
};
