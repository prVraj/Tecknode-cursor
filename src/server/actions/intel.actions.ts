"use server";

import { z } from "zod";
import { accountAction } from "@/server/action-utils";
import { signalRepo } from "@/server/db/repos/signal.repo";
import { signalFeedbackRepo } from "@/server/db/repos/signal-feedback.repo";
import { trackedEntityRepo } from "@/server/db/repos/tracked-entity.repo";
import { userIntelSettingsRepo } from "@/server/db/repos/user-intel-settings.repo";
import {
  type EnabledCapabilities,
  SIGNAL_FEEDBACK_RATINGS,
  SIGNAL_FEEDBACK_REASONS,
} from "@/server/db/schema";

// NOTE: Engine-triggering actions (add-entity discovery, running connectors,
// generating digests) depend on the signal engine and are deferred to a later
// task. Everything here is repo-only and strictly ownership-scoped: record IDs
// are inputs, ownership is always checked against `ctx.userId` — never trusted
// from the client.

const idInput = z.object({ entityId: z.string().min(1) });

export const listTrackedEntitiesAction = accountAction(
  async (ctx) => {
    return trackedEntityRepo.listByUser(ctx.userId);
  },
  { name: "listTrackedEntities" },
);

export const removeTrackedEntityAction = accountAction(
  idInput,
  async (ctx, { entityId }) => {
    const removed = await trackedEntityRepo.deleteById(entityId, ctx.userId);
    if (!removed) throw new Error("Not found");
    return { removed: true as const, id: removed.id };
  },
  { name: "removeTrackedEntity" },
);

const listSignalsInput = z.object({
  entityId: z.string().min(1).optional(),
  limit: z.number().int().positive().max(200).optional(),
  since: z.coerce.date().optional(),
});

export const listSignalsAction = accountAction(
  listSignalsInput,
  async (ctx, input) => {
    return signalRepo.listByUser(ctx.userId, input);
  },
  { name: "listSignals" },
);

export const getSignalAction = accountAction(
  z.object({ signalId: z.string().min(1) }),
  async (ctx, { signalId }) => {
    const signal = await signalRepo.findById(signalId, ctx.userId);
    if (!signal) throw new Error("Not found");
    return signal;
  },
  { name: "getSignal" },
);

const feedbackInput = z.object({
  signalId: z.string().min(1),
  rating: z.enum(SIGNAL_FEEDBACK_RATINGS),
  reason: z.enum(SIGNAL_FEEDBACK_REASONS).optional(),
  note: z.string().max(1000).optional(),
});

export const submitSignalFeedbackAction = accountAction(
  feedbackInput,
  async (ctx, input) => {
    // Ownership gate: the signal must belong to the caller before any feedback
    // row is written, so a forged foreign signalId can't attach feedback.
    const signal = await signalRepo.findById(input.signalId, ctx.userId);
    if (!signal) throw new Error("Not found");

    const row = await signalFeedbackRepo.upsert({
      signalId: input.signalId,
      userId: ctx.userId,
      rating: input.rating,
      reason: input.reason ?? null,
      note: input.note ?? null,
    });
    return { id: row.id, rating: row.rating };
  },
  { name: "submitSignalFeedback" },
);

export const getIntelSettingsAction = accountAction(
  async (ctx) => {
    return userIntelSettingsRepo.ensure(ctx.userId);
  },
  { name: "getIntelSettings" },
);

const updateSettingsInput = z.object({
  enabledCapabilities: z.record(z.string(), z.boolean()),
});

export const updateIntelSettingsAction = accountAction(
  updateSettingsInput,
  async (ctx, { enabledCapabilities }) => {
    const updated = await userIntelSettingsRepo.updateEnabledCapabilities(
      ctx.userId,
      enabledCapabilities as EnabledCapabilities,
    );
    if (!updated) throw new Error("Not found");
    return updated;
  },
  { name: "updateIntelSettings" },
);
