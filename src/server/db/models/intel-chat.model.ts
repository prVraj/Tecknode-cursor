import {
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { user } from "./auth.model";

// ── digest_runs ───────────────────────────────────────────────────────────

export interface DigestBullet {
  text: string;
  signalIds: string[];
}

export interface DigestSection {
  heading: string;
  bullets: DigestBullet[];
}

export interface DigestAction {
  text: string;
  signalIds: string[];
}

export interface DigestOutput {
  headline: string;
  sections: DigestSection[];
  suggestedActions: DigestAction[];
}

export const DIGEST_STATUSES = ["empty", "ready", "failed"] as const;
export type DigestStatus = (typeof DIGEST_STATUSES)[number];

export const digestRuns = pgTable(
  "digest_runs",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    periodStart: timestamp("period_start").notNull(),
    periodEnd: timestamp("period_end").notNull(),
    status: text("status", { enum: DIGEST_STATUSES })
      .notNull()
      .default("ready"),
    /** Source signals (resolved at query time) — count is denormalized for cheap rendering. */
    signalCount: numeric("signal_count", { precision: 10, scale: 0 })
      .notNull()
      .default("0"),
    output: jsonb("output").$type<DigestOutput | null>(),
    model: text("model"),
    /** Cost in fractional dollars for the LLM call. */
    costUnits: numeric("cost_units", { precision: 10, scale: 4 }),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("digest_runs_user_period_uidx").on(
      table.userId,
      table.periodStart,
      table.periodEnd,
    ),
    index("digest_runs_user_created_idx").on(table.userId, table.createdAt),
  ],
);

export type DigestRun = typeof digestRuns.$inferSelect;
export type NewDigestRun = typeof digestRuns.$inferInsert;

// ── intel_conversations ───────────────────────────────────────────────────

export const intelConversations = pgTable(
  "intel_conversations",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Truncated first user message — for sidebar listing. */
    title: text("title"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("intel_conversations_user_idx").on(table.userId),
    index("intel_conversations_updated_idx").on(table.updatedAt),
  ],
);

export type IntelConversation = typeof intelConversations.$inferSelect;
export type NewIntelConversation = typeof intelConversations.$inferInsert;

// ── intel_messages ────────────────────────────────────────────────────────

export const INTEL_MESSAGE_ROLES = [
  "user",
  "assistant",
  "tool",
  "system",
] as const;
export type IntelMessageRole = (typeof INTEL_MESSAGE_ROLES)[number];

/**
 * `content` is a JSON blob. Role is denormalized to its own column for cheap
 * filtering. `parts` is the full UIMessage parts array, so a reloaded thread
 * replays tool-status pills + attachment chips identically to the live session.
 */
export const intelMessages = pgTable(
  "intel_messages",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => intelConversations.id, { onDelete: "cascade" }),
    role: text("role", { enum: INTEL_MESSAGE_ROLES }).notNull(),
    content: jsonb("content").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("intel_messages_conversation_idx").on(
      table.conversationId,
      table.createdAt,
    ),
  ],
);

export type IntelMessage = typeof intelMessages.$inferSelect;
export type NewIntelMessage = typeof intelMessages.$inferInsert;
