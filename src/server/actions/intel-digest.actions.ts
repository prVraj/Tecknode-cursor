"use server";

import { z } from "zod";
import { accountAction } from "@/server/action-utils";
import { digestRepo } from "@/server/db/repos/digest.repo";

// Digest *generation* runs the signal engine and is deferred to a later task.
// These read-only actions expose already-produced digest runs, scoped to the
// caller via `ctx.userId`.

const limitInput = z.object({
  limit: z.number().int().positive().max(50).optional(),
});

export const listDigestsAction = accountAction(
  limitInput,
  async (ctx, { limit }) => {
    return digestRepo.listByUser(ctx.userId, limit ?? 20);
  },
  { name: "listDigests" },
);

export const getLatestDigestAction = accountAction(
  async (ctx) => {
    return digestRepo.findLatest(ctx.userId);
  },
  { name: "getLatestDigest" },
);

export const getDigestAction = accountAction(
  z.object({ digestId: z.string().min(1) }),
  async (ctx, { digestId }) => {
    const digest = await digestRepo.findByIdForUser(digestId, ctx.userId);
    if (!digest) throw new Error("Not found");
    return digest;
  },
  { name: "getDigest" },
);
