import { and, count, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/server/db";
import {
  type MentionCapability,
  type MentionRecord,
  mentionRecords,
  type NewMentionRecord,
} from "@/server/db/schema";

export const mentionRecordRepo = {
  /**
   * Bulk upsert by the dedup key (entityId, platform, externalId).
   * A mention seen in a later scan keeps its original firstSeenAt but refreshes
   * engagement + classification. Returns the count of newly-inserted rows
   * (first seen this scan) — the "new mention" signal.
   *
   * The new-count is computed deterministically: we look up which dedup keys in
   * this batch already exist, then count the rest. Runs are serialized per
   * entity+capability (idempotency key), so this read-then-write is race-free —
   * and it avoids the app-vs-DB clock skew a `firstSeenAt` time window would
   * introduce.
   */
  async upsertMany(records: NewMentionRecord[]): Promise<{ inserted: number }> {
    if (records.length === 0) return { inserted: 0 };

    const entityIds = [...new Set(records.map((r) => r.entityId))];
    const externalIds = [...new Set(records.map((r) => r.externalId))];
    const existing = await db
      .select({
        entityId: mentionRecords.entityId,
        platform: mentionRecords.platform,
        externalId: mentionRecords.externalId,
      })
      .from(mentionRecords)
      .where(
        and(
          inArray(mentionRecords.entityId, entityIds),
          inArray(mentionRecords.externalId, externalIds),
        ),
      );
    const seen = new Set(
      existing.map((r) => `${r.entityId}|${r.platform}|${r.externalId}`),
    );
    const inserted = records.filter(
      (r) => !seen.has(`${r.entityId}|${r.platform}|${r.externalId}`),
    ).length;

    await db
      .insert(mentionRecords)
      .values(records)
      .onConflictDoUpdate({
        target: [
          mentionRecords.entityId,
          mentionRecords.platform,
          mentionRecords.externalId,
        ],
        set: {
          // refresh volatile fields; firstSeenAt is intentionally NOT updated
          engagementScore: sql`excluded.engagement_score`,
          comments: sql`excluded.comments`,
          shares: sql`excluded.shares`,
          impressions: sql`excluded.impressions`,
          authorFollowers: sql`excluded.author_followers`,
          sentiment: sql`excluded.sentiment`,
          signalType: sql`excluded.signal_type`,
          priority: sql`excluded.priority`,
          isInfluencer: sql`excluded.is_influencer`,
          runId: sql`excluded.run_id`,
        },
      });

    return { inserted };
  },

  /**
   * All mentions for an entity (newest first) — feeds trends + reads.
   * Pass `capability` to view only brand- or keyword-driven mentions.
   */
  listByEntity: (
    entityId: string,
    capability?: MentionCapability,
    limit = 1000,
  ): Promise<MentionRecord[]> =>
    db
      .select()
      .from(mentionRecords)
      .where(
        capability
          ? and(
              eq(mentionRecords.entityId, entityId),
              eq(mentionRecords.capabilityKey, capability),
            )
          : eq(mentionRecords.entityId, entityId),
      )
      .orderBy(desc(mentionRecords.postedAt))
      .limit(limit),

  /** Mentions posted on/after `since` — for spike/digest windows. */
  listByEntitySince: (
    entityId: string,
    since: Date,
    limit = 2000,
  ): Promise<MentionRecord[]> =>
    db
      .select()
      .from(mentionRecords)
      .where(
        and(
          eq(mentionRecords.entityId, entityId),
          gte(mentionRecords.postedAt, since),
        ),
      )
      .orderBy(desc(mentionRecords.postedAt))
      .limit(limit),

  /**
   * Mention counts per entity in a [start, end) window — drives competitive
   * share-of-voice (each entity's slice of the user-wide conversation).
   */
  countByEntitiesBetween: (
    entityIds: string[],
    start: Date,
    end: Date,
  ): Promise<Array<{ entityId: string; total: number }>> => {
    if (entityIds.length === 0) return Promise.resolve([]);
    return db
      .select({ entityId: mentionRecords.entityId, total: count() })
      .from(mentionRecords)
      .where(
        and(
          inArray(mentionRecords.entityId, entityIds),
          gte(mentionRecords.postedAt, start),
          lt(mentionRecords.postedAt, end),
        ),
      )
      .groupBy(mentionRecords.entityId);
  },
};
