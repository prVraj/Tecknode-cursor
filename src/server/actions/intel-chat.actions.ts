"use server";

import { z } from "zod";
import { accountAction } from "@/server/action-utils";
import {
  intelConversationRepo,
  intelMessageRepo,
} from "@/server/db/repos/intel-conversation.repo";

// "Ask Intel" answer generation depends on the signal engine / LLM and is
// deferred to a later task. These actions manage conversation + message
// records, always scoped to the caller via `ctx.userId`.

const limitInput = z.object({
  limit: z.number().int().positive().max(100).optional(),
});

export const listConversationsAction = accountAction(
  limitInput,
  async (ctx, { limit }) => {
    return intelConversationRepo.listByUser(ctx.userId, limit ?? 30);
  },
  { name: "listConversations" },
);

export const createConversationAction = accountAction(
  z.object({ title: z.string().max(200).optional() }),
  async (ctx, { title }) => {
    return intelConversationRepo.create({
      userId: ctx.userId,
      title: title ?? null,
    });
  },
  { name: "createConversation" },
);

export const getConversationAction = accountAction(
  z.object({ conversationId: z.string().min(1) }),
  async (ctx, { conversationId }) => {
    // Ownership gate before any message rows are read.
    const conversation = await intelConversationRepo.findById(
      conversationId,
      ctx.userId,
    );
    if (!conversation) throw new Error("Not found");
    const messages = await intelMessageRepo.listByConversation(conversationId);
    return { conversation, messages };
  },
  { name: "getConversation" },
);
