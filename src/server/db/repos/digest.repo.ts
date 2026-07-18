import { and, desc, eq } from "drizzle-orm";
import { db } from "@/server/db";
import {
  type DigestRun,
  digestRuns,
  type NewDigestRun,
} from "@/server/db/schema";

export const digestRepo = {
  create: (data: NewDigestRun): Promise<DigestRun> =>
    db
      .insert(digestRuns)
      .values(data)
      .onConflictDoNothing({
        target: [
          digestRuns.userId,
          digestRuns.periodStart,
          digestRuns.periodEnd,
        ],
      })
      .returning()
      .then((rows) => rows[0] ?? null)
      .then((row) => {
        if (row) return row;
        // Already exists — fetch it.
        return db
          .select()
          .from(digestRuns)
          .where(
            and(
              eq(digestRuns.userId, data.userId),
              eq(digestRuns.periodStart, data.periodStart),
              eq(digestRuns.periodEnd, data.periodEnd),
            ),
          )
          .then((rows) => rows[0]);
      }),

  findLatest: (userId: string): Promise<DigestRun | null> =>
    db
      .select()
      .from(digestRuns)
      .where(eq(digestRuns.userId, userId))
      .orderBy(desc(digestRuns.createdAt))
      .limit(1)
      .then((rows) => rows[0] ?? null),

  /** Ownership-scoped single fetch. */
  findByIdForUser: (id: string, userId: string): Promise<DigestRun | null> =>
    db
      .select()
      .from(digestRuns)
      .where(and(eq(digestRuns.id, id), eq(digestRuns.userId, userId)))
      .then((rows) => rows[0] ?? null),

  listByUser: (userId: string, limit = 20): Promise<DigestRun[]> =>
    db
      .select()
      .from(digestRuns)
      .where(eq(digestRuns.userId, userId))
      .orderBy(desc(digestRuns.createdAt))
      .limit(limit),
};
