import { and, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { type EntityState, entityState } from "@/server/db/schema";

export const entityStateRepo = {
  /**
   * Upsert the state blob for (entityId, stateKey). Replaces payload +
   * content_hash and bumps captured_at when a row already exists — relies on
   * the `entity_state_entity_key_uidx` unique index as the conflict target.
   */
  upsert: (data: {
    userId: string;
    entityId: string;
    stateKey: string;
    payload: Record<string, unknown>;
    contentHash?: string | null;
  }): Promise<EntityState> =>
    db
      .insert(entityState)
      .values({
        userId: data.userId,
        entityId: data.entityId,
        stateKey: data.stateKey,
        payload: data.payload,
        contentHash: data.contentHash ?? null,
        capturedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [entityState.entityId, entityState.stateKey],
        set: {
          payload: data.payload,
          contentHash: data.contentHash ?? null,
          capturedAt: new Date(),
        },
      })
      .returning()
      .then((rows) => rows[0]),

  /** The single state blob for (entityId, stateKey), or null when unset. */
  find: (entityId: string, stateKey: string): Promise<EntityState | null> =>
    db
      .select()
      .from(entityState)
      .where(
        and(
          eq(entityState.entityId, entityId),
          eq(entityState.stateKey, stateKey),
        ),
      )
      .limit(1)
      .then((rows) => rows[0] ?? null),
};
