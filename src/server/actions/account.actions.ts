"use server";

import { eq } from "drizzle-orm";
import { z } from "zod";
import { UserFacingError } from "@/lib/errors";
import { accountAction } from "@/server/action-utils";
import { db } from "@/server/db";
import { session, user } from "@/server/db/models/auth.model";
import { accountDeletionRepo } from "@/server/db/repos/account-deletion.repo";

/** Grace period before a scheduled deletion is hard-purged (Privacy Policy). */
const ACCOUNT_DELETE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Self-serve JSON data export for the signed-in user. Only the caller's own
 * record is ever returned — ownership is derived from `ctx.userId`.
 */
export const exportMyDataAction = accountAction(
  async (ctx) => {
    const [profile, pendingDeletion] = await Promise.all([
      db.query.user.findFirst({ where: eq(user.id, ctx.userId) }),
      accountDeletionRepo.findPendingByUser(ctx.userId),
    ]);
    if (!profile) throw new Error("Not found");

    return {
      exportedAt: new Date().toISOString(),
      user: {
        id: profile.id,
        name: profile.name,
        email: profile.email,
        emailVerified: profile.emailVerified,
        image: profile.image,
        createdAt: profile.createdAt,
        updatedAt: profile.updatedAt,
      },
      accountDeletion: pendingDeletion
        ? { status: "pending" as const, purgeAfter: pendingDeletion.purgeAfter }
        : null,
    };
  },
  { name: "exportMyData" },
);

/**
 * Schedule account deletion with a 30-day grace period. Immediately
 * invalidates all of the user's sessions so the account can't keep operating
 * while the purge is pending. The hard-delete runs later via a retention cron.
 */
export const requestAccountDeletionAction = accountAction(
  z.object({ confirmEmail: z.string().email() }),
  async (ctx, { confirmEmail }) => {
    if (
      confirmEmail.trim().toLowerCase() !== ctx.user.email.trim().toLowerCase()
    ) {
      throw new UserFacingError(
        "Email confirmation does not match your account",
      );
    }

    const existing = await accountDeletionRepo.findPendingByUser(ctx.userId);
    if (existing) {
      return {
        status: "already_scheduled" as const,
        purgeAfter: existing.purgeAfter,
      };
    }

    const purgeAfter = new Date(Date.now() + ACCOUNT_DELETE_DAYS * DAY_MS);

    const row = await accountDeletionRepo.upsertPending({
      userId: ctx.userId,
      purgeAfter,
      requestedByUserId: ctx.userId,
    });

    // Invalidate every session for this user (sign out everywhere).
    await db.delete(session).where(eq(session.userId, ctx.userId));

    return { status: "scheduled" as const, purgeAfter: row.purgeAfter };
  },
  { name: "requestAccountDeletion" },
);

export const getAccountDeletionStatusAction = accountAction(
  async (ctx) => {
    const pending = await accountDeletionRepo.findPendingByUser(ctx.userId);
    return pending
      ? { pending: true as const, purgeAfter: pending.purgeAfter }
      : { pending: false as const, purgeAfter: null };
  },
  { name: "getAccountDeletionStatus" },
);

export const cancelAccountDeletionAction = accountAction(
  async (ctx) => {
    await accountDeletionRepo.cancel(ctx.userId);
    return { cancelled: true as const };
  },
  { name: "cancelAccountDeletion" },
);
