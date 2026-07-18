import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  process.env.SKIP_ENV_VALIDATION = "true";
  return {
    getSession: vi.fn(),
    findPendingByUser: vi.fn(),
    upsertPending: vi.fn(),
    cancel: vi.fn(),
    findFirstUser: vi.fn(),
    deleteWhere: vi.fn(),
  };
});

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: mocks.getSession } },
}));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("@/server/db", () => ({
  db: {
    query: { user: { findFirst: mocks.findFirstUser } },
    delete: () => ({ where: mocks.deleteWhere }),
  },
}));
vi.mock("@/server/db/repos/account-deletion.repo", () => ({
  accountDeletionRepo: {
    findPendingByUser: mocks.findPendingByUser,
    upsertPending: mocks.upsertPending,
    cancel: mocks.cancel,
  },
}));

import {
  cancelAccountDeletionAction,
  exportMyDataAction,
  requestAccountDeletionAction,
} from "@/server/actions/account.actions";

function signedInAs(userId: string, email: string) {
  mocks.getSession.mockResolvedValue({
    user: { id: userId, name: "User", email, emailVerified: true },
    session: { id: "sess-1", userId },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.deleteWhere.mockResolvedValue(undefined);
});

describe("exportMyDataAction", () => {
  it("returns only the caller's own record", async () => {
    signedInAs("user-a", "a@example.com");
    mocks.findFirstUser.mockResolvedValue({
      id: "user-a",
      name: "User",
      email: "a@example.com",
      emailVerified: true,
      image: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mocks.findPendingByUser.mockResolvedValue(null);

    const result = await exportMyDataAction();
    expect(result).toMatchObject({ user: { id: "user-a" } });
  });
});

describe("requestAccountDeletionAction", () => {
  it("rejects a mismatched confirmation email (user-facing)", async () => {
    signedInAs("user-a", "a@example.com");
    const result = await requestAccountDeletionAction({
      confirmEmail: "someone-else@example.com",
    });
    expect(result).toEqual({
      error: "Email confirmation does not match your account",
    });
  });

  it("schedules deletion and invalidates all sessions", async () => {
    signedInAs("user-a", "a@example.com");
    mocks.findPendingByUser.mockResolvedValue(null);
    const purgeAfter = new Date(Date.now() + 30 * 86400000);
    mocks.upsertPending.mockResolvedValue({ purgeAfter });

    const result = await requestAccountDeletionAction({
      confirmEmail: "a@example.com",
    });

    expect(result).toEqual({ status: "scheduled", purgeAfter });
    expect(mocks.upsertPending).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-a" }),
    );
    // Sessions were invalidated (sign out everywhere).
    expect(mocks.deleteWhere).toHaveBeenCalledTimes(1);
  });

  it("is idempotent when a deletion is already pending", async () => {
    signedInAs("user-a", "a@example.com");
    const purgeAfter = new Date();
    mocks.findPendingByUser.mockResolvedValue({ purgeAfter });

    const result = await requestAccountDeletionAction({
      confirmEmail: "a@example.com",
    });

    expect(result).toEqual({ status: "already_scheduled", purgeAfter });
    expect(mocks.upsertPending).not.toHaveBeenCalled();
    expect(mocks.deleteWhere).not.toHaveBeenCalled();
  });
});

describe("cancelAccountDeletionAction", () => {
  it("cancels a pending deletion for the caller", async () => {
    signedInAs("user-a", "a@example.com");
    const result = await cancelAccountDeletionAction();
    expect(result).toEqual({ cancelled: true });
    expect(mocks.cancel).toHaveBeenCalledWith("user-a");
  });
});
