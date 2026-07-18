import { and, eq, lte } from "drizzle-orm";
import { db } from "@/server/db";
import {
  accountDeletionRequests,
  type NewAccountDeletionRequest,
} from "@/server/db/models/account-deletion.model";

export const accountDeletionRepo = {
  findPendingByUser: (userId: string) =>
    db
      .select()
      .from(accountDeletionRequests)
      .where(
        and(
          eq(accountDeletionRequests.userId, userId),
          eq(accountDeletionRequests.status, "pending"),
        ),
      )
      .then((rows) => rows[0] ?? null),

  upsertPending: async (data: {
    userId: string;
    purgeAfter: Date;
    requestedByUserId: string;
  }) => {
    const existing = await accountDeletionRepo.findPendingByUser(data.userId);
    if (existing) return existing;

    const row: NewAccountDeletionRequest = {
      userId: data.userId,
      purgeAfter: data.purgeAfter,
      requestedByUserId: data.requestedByUserId,
      status: "pending",
    };
    return db
      .insert(accountDeletionRequests)
      .values(row)
      .returning()
      .then((rows) => rows[0]);
  },

  listDue: (now: Date, limit = 50) =>
    db
      .select()
      .from(accountDeletionRequests)
      .where(
        and(
          eq(accountDeletionRequests.status, "pending"),
          lte(accountDeletionRequests.purgeAfter, now),
        ),
      )
      .limit(limit),

  markCompleted: (id: string) =>
    db
      .update(accountDeletionRequests)
      .set({ status: "completed", completedAt: new Date() })
      .where(eq(accountDeletionRequests.id, id)),

  cancel: (userId: string) =>
    db
      .update(accountDeletionRequests)
      .set({ status: "cancelled", completedAt: new Date() })
      .where(
        and(
          eq(accountDeletionRequests.userId, userId),
          eq(accountDeletionRequests.status, "pending"),
        ),
      ),
};
