import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/server/db";
import {
  type NewSignalFeedback,
  type SignalFeedback,
  signalFeedback,
} from "@/server/db/schema";

export const signalFeedbackRepo = {
  /**
   * Upsert one user's feedback for a signal. The `(signalId, userId)` unique
   * index makes this a toggle/update — re-rating overwrites the prior row.
   */
  upsert: (data: NewSignalFeedback): Promise<SignalFeedback> =>
    db
      .insert(signalFeedback)
      .values(data)
      .onConflictDoUpdate({
        target: [signalFeedback.signalId, signalFeedback.userId],
        set: {
          rating: data.rating,
          reason: data.reason ?? null,
          note: data.note ?? null,
          updatedAt: new Date(),
        },
      })
      .returning()
      .then((rows) => rows[0]),

  /** Clear a user's feedback for a signal (toggle-off). */
  remove: (signalId: string, userId: string): Promise<void> =>
    db
      .delete(signalFeedback)
      .where(
        and(
          eq(signalFeedback.signalId, signalId),
          eq(signalFeedback.userId, userId),
        ),
      )
      .then(() => undefined),

  /** This user's feedback rows for the given signal ids (to seed the UI). */
  listForUser: (
    userId: string,
    signalIds: string[],
  ): Promise<SignalFeedback[]> => {
    if (signalIds.length === 0) return Promise.resolve([]);
    return db
      .select()
      .from(signalFeedback)
      .where(
        and(
          eq(signalFeedback.userId, userId),
          inArray(signalFeedback.signalId, signalIds),
        ),
      );
  },
};
