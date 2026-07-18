import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import {
  DEFAULT_ENABLED_CAPABILITIES,
  type EnabledCapabilities,
  userIntelSettings,
} from "@/server/db/schema";

export const userIntelSettingsRepo = {
  /** Returns the settings row, creating it with defaults if missing. */
  ensure: async (userId: string) => {
    const existing = await db
      .select()
      .from(userIntelSettings)
      .where(eq(userIntelSettings.userId, userId))
      .then((rows) => rows[0]);
    if (existing) return existing;

    const inserted = await db
      .insert(userIntelSettings)
      .values({
        userId,
        enabledCapabilities: DEFAULT_ENABLED_CAPABILITIES,
      })
      .onConflictDoNothing({ target: userIntelSettings.userId })
      .returning();

    if (inserted[0]) return inserted[0];

    return db
      .select()
      .from(userIntelSettings)
      .where(eq(userIntelSettings.userId, userId))
      .then((rows) => rows[0]);
  },

  get: (userId: string) =>
    db
      .select()
      .from(userIntelSettings)
      .where(eq(userIntelSettings.userId, userId))
      .then((rows) => rows[0] ?? null),

  updateEnabledCapabilities: (
    userId: string,
    enabledCapabilities: EnabledCapabilities,
  ) =>
    db
      .update(userIntelSettings)
      .set({ enabledCapabilities, updatedAt: new Date() })
      .where(eq(userIntelSettings.userId, userId))
      .returning()
      .then((rows) => rows[0] ?? null),
};
