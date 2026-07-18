import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/server/db";
import {
  type IntelConversation,
  type IntelMessage,
  intelConversations,
  intelMessages,
  type NewIntelConversation,
  type NewIntelMessage,
} from "@/server/db/schema";

export const intelConversationRepo = {
  create: (data: NewIntelConversation): Promise<IntelConversation> =>
    db
      .insert(intelConversations)
      .values(data)
      .returning()
      .then((rows) => rows[0]),

  /** Ownership-scoped fetch: returns the conversation only if the user owns it. */
  findById: (id: string, userId: string): Promise<IntelConversation | null> =>
    db
      .select()
      .from(intelConversations)
      .where(
        and(
          eq(intelConversations.id, id),
          eq(intelConversations.userId, userId),
        ),
      )
      .then((rows) => rows[0] ?? null),

  listByUser: (userId: string, limit = 30): Promise<IntelConversation[]> =>
    db
      .select()
      .from(intelConversations)
      .where(eq(intelConversations.userId, userId))
      .orderBy(desc(intelConversations.updatedAt))
      .limit(limit),

  touch: (id: string): Promise<void> =>
    db
      .update(intelConversations)
      .set({ updatedAt: new Date() })
      .where(eq(intelConversations.id, id))
      .then(() => undefined),
};

export const intelMessageRepo = {
  append: (data: NewIntelMessage): Promise<IntelMessage> =>
    db
      .insert(intelMessages)
      .values(data)
      .returning()
      .then((rows) => rows[0]),

  appendMany: (rows: NewIntelMessage[]): Promise<IntelMessage[]> => {
    if (rows.length === 0) return Promise.resolve([]);
    return db.insert(intelMessages).values(rows).returning();
  },

  listByConversation: (conversationId: string): Promise<IntelMessage[]> =>
    db
      .select()
      .from(intelMessages)
      .where(eq(intelMessages.conversationId, conversationId))
      .orderBy(asc(intelMessages.createdAt)),
};
