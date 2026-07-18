import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "./auth.model";

/**
 * Soft account-deletion queue. Self-serve deletion schedules a purge; a
 * retention cron hard-deletes the user after `purgeAfter`
 * (default: requestedAt + 30 days), matching the Privacy Policy.
 */
export const ACCOUNT_DELETION_STATUSES = [
  "pending",
  "completed",
  "cancelled",
] as const;
export type AccountDeletionStatus = (typeof ACCOUNT_DELETION_STATUSES)[number];

export const accountDeletionRequests = pgTable(
  "account_deletion_requests",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .unique()
      .references(() => user.id, { onDelete: "cascade" }),
    requestedAt: timestamp("requested_at").defaultNow().notNull(),
    purgeAfter: timestamp("purge_after").notNull(),
    status: text("status", { enum: ACCOUNT_DELETION_STATUSES })
      .notNull()
      .default("pending"),
    /** User id that initiated the request (self-serve for this build). */
    requestedByUserId: text("requested_by_user_id"),
    completedAt: timestamp("completed_at"),
  },
  (table) => [
    index("account_deletion_requests_status_purge_idx").on(
      table.status,
      table.purgeAfter,
    ),
  ],
);

export type AccountDeletionRequest =
  typeof accountDeletionRequests.$inferSelect;
export type NewAccountDeletionRequest =
  typeof accountDeletionRequests.$inferInsert;
