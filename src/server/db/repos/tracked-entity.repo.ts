import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/server/db";
import {
  type NewTrackedEntity,
  type TrackedEntity,
  trackedEntities,
} from "@/server/db/schema";

export const trackedEntityRepo = {
  create: (data: NewTrackedEntity) =>
    db
      .insert(trackedEntities)
      .values(data)
      .returning()
      .then((rows) => rows[0]),

  findById: (id: string): Promise<TrackedEntity | null> =>
    db
      .select()
      .from(trackedEntities)
      .where(eq(trackedEntities.id, id))
      .then((rows) => rows[0] ?? null),

  /** Ownership-scoped fetch: returns the row only if it belongs to the user. */
  findByIdForUser: (
    id: string,
    userId: string,
  ): Promise<TrackedEntity | null> =>
    db
      .select()
      .from(trackedEntities)
      .where(
        and(eq(trackedEntities.id, id), eq(trackedEntities.userId, userId)),
      )
      .then((rows) => rows[0] ?? null),

  listByUser: (userId: string) =>
    db
      .select()
      .from(trackedEntities)
      .where(eq(trackedEntities.userId, userId))
      .orderBy(asc(trackedEntities.role), asc(trackedEntities.domain)),

  findByUserAndDomain: (userId: string, domain: string) =>
    db
      .select()
      .from(trackedEntities)
      .where(
        and(
          eq(trackedEntities.userId, userId),
          eq(trackedEntities.domain, domain),
        ),
      )
      .then((rows) => rows[0] ?? null),

  findPrimary: (userId: string) =>
    db
      .select()
      .from(trackedEntities)
      .where(
        and(
          eq(trackedEntities.userId, userId),
          eq(trackedEntities.role, "primary"),
        ),
      )
      .then((rows) => rows[0] ?? null),

  countPrimary: (userId: string) =>
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(trackedEntities)
      .where(
        and(
          eq(trackedEntities.userId, userId),
          eq(trackedEntities.role, "primary"),
        ),
      )
      .then((rows) => rows[0]?.count ?? 0),

  countCompetitors: (userId: string) =>
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(trackedEntities)
      .where(
        and(
          eq(trackedEntities.userId, userId),
          eq(trackedEntities.role, "competitor"),
        ),
      )
      .then((rows) => rows[0]?.count ?? 0),

  deleteById: (id: string, userId: string) =>
    db
      .delete(trackedEntities)
      .where(
        and(eq(trackedEntities.id, id), eq(trackedEntities.userId, userId)),
      )
      .returning()
      .then((rows) => rows[0] ?? null),

  update: (id: string, userId: string, data: Partial<NewTrackedEntity>) =>
    db
      .update(trackedEntities)
      .set({ ...data, updatedAt: new Date() })
      .where(
        and(eq(trackedEntities.id, id), eq(trackedEntities.userId, userId)),
      )
      .returning()
      .then((rows) => rows[0] ?? null),
};
