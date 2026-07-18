import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { user } from "./auth.model";
import { trackedEntities } from "./intel.model";

/**
 * Generic per-entity key/value state store for diff modules that need to
 * persist arbitrary "last seen" state between runs.
 *
 * One row per (entity_id, state_key). `state_key` namespaces the payload so a
 * single entity can hold several independent blobs. `content_hash` is an
 * optional stable hash of the payload so hash-based diffs can anchor their
 * "before" state here instead of the `signals` table.
 */
export const entityState = pgTable(
  "entity_state",
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
    /** Namespaced key, e.g. "ads:creatives", "ads:volume". */
    stateKey: text("state_key").notNull(),
    /** Arbitrary JSON blob owned by the writing module. */
    payload: jsonb("payload").notNull().$type<Record<string, unknown>>(),
    /** Optional stable content hash of the payload — anchors hash-based diffs. */
    contentHash: text("content_hash"),
    capturedAt: timestamp("captured_at").defaultNow().notNull(),
  },
  (table) => [
    // One state blob per (entity, key) — the upsert conflict target.
    uniqueIndex("entity_state_entity_key_uidx").on(
      table.entityId,
      table.stateKey,
    ),
    index("entity_state_user_idx").on(table.userId),
  ],
);

export type EntityState = typeof entityState.$inferSelect;
export type NewEntityState = typeof entityState.$inferInsert;
