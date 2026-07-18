import {
  boolean,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { user } from "./auth.model";
import { connectorRuns, trackedEntities } from "./intel.model";

/**
 * Item-level brand/keyword mentions. `signal_snapshots` holds the daily SCALAR
 * rollup (primaryScore = totalMentions); this table holds the high-cardinality
 * item-level rows that a scalar can't reconstruct. `connector_runs` (one row
 * per scan) is the parent run.
 */

export const MENTION_CAPABILITIES = [
  "mentions_brand",
  "mentions_keyword",
] as const;
export type MentionCapability = (typeof MENTION_CAPABILITIES)[number];

// Active mention sources. The column is plain `text`, so legacy rows with
// retired values still read fine; the read layer drops them via an allowlist.
export const MENTION_PLATFORMS = [
  "x",
  "reddit",
  "hn",
  "bluesky",
  "youtube",
  "producthunt",
  "stackoverflow",
  "wikipedia",
] as const;

export const MENTION_SIGNAL_TYPES = [
  "brand_mention",
  "pain_point",
  "churn",
  "comparison",
  "positive_churn",
  "buying_intent",
  "feature_request",
] as const;

export const MENTION_SENTIMENTS = ["positive", "neutral", "negative"] as const;
export const MENTION_PRIORITIES = ["P0", "P1", "P2"] as const;

export const mentionRecords = pgTable(
  "mention_records",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    entityId: text("entity_id")
      .notNull()
      .references(() => trackedEntities.id, { onDelete: "cascade" }),
    /** Nullable — manual scans without a connector_run still persist. */
    runId: text("run_id").references(() => connectorRuns.id, {
      onDelete: "set null",
    }),
    capabilityKey: text("capability_key", {
      enum: MENTION_CAPABILITIES,
    }).notNull(),

    platform: text("platform", { enum: MENTION_PLATFORMS }).notNull(),
    /** Platform-native post id — dedup target. */
    externalId: text("external_id").notNull(),
    url: text("url").notNull(),
    body: text("body").notNull(),
    context: text("context"),

    authorName: text("author_name"),
    authorHandle: text("author_handle"),
    authorFollowers: integer("author_followers"),

    engagementScore: integer("engagement_score"),
    comments: integer("comments"),
    shares: integer("shares"),
    impressions: integer("impressions"),

    sentiment: text("sentiment", { enum: MENTION_SENTIMENTS }),
    signalType: text("signal_type", { enum: MENTION_SIGNAL_TYPES }),
    priority: text("priority", { enum: MENTION_PRIORITIES }),
    isInfluencer: boolean("is_influencer").notNull().default(false),

    /** Mention's own createdAt — drives volume/sentiment trends. */
    postedAt: timestamp("posted_at").notNull(),
    /** First scan that observed it = the "new mention" marker. */
    firstSeenAt: timestamp("first_seen_at").defaultNow().notNull(),
    capturedDate: date("captured_date").notNull(),
  },
  (t) => [
    uniqueIndex("mention_records_dedup_uidx").on(
      t.entityId,
      t.platform,
      t.externalId,
    ),
    index("mention_records_entity_posted_idx").on(
      t.entityId,
      t.capabilityKey,
      t.postedAt,
    ),
    index("mention_records_entity_priority_idx").on(t.entityId, t.priority),
    index("mention_records_user_signal_idx").on(t.userId, t.signalType),
  ],
);

export type MentionRecord = typeof mentionRecords.$inferSelect;
export type NewMentionRecord = typeof mentionRecords.$inferInsert;
