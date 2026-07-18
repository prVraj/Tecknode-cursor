import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  process.env.SKIP_ENV_VALIDATION = "true";
  return { getSession: vi.fn() };
});

// Mock the auth module so importing action-utils does not pull the real
// auth.ts import graph (db/env/emails). Tests drive `getSession` directly.
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: mocks.getSession } },
}));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));

import {
  accountAction,
  resolveAccountContext,
  UserFacingError,
} from "@/server/action-utils";

function verifiedSession(userId: string) {
  return {
    user: {
      id: userId,
      name: "User",
      email: `${userId}@example.com`,
      emailVerified: true,
    },
    session: { id: "sess-1", userId },
    // biome-ignore lint/suspicious/noExplicitAny: minimal test fixture
  } as any;
}

describe("resolveAccountContext", () => {
  it("rejects a request without a session", async () => {
    await expect(resolveAccountContext(null)).rejects.toThrow(
      "UNAUTHENTICATED",
    );
  });

  it("uses only the session user id", async () => {
    const context = await resolveAccountContext(verifiedSession("user-a"));
    expect(context.userId).toBe("user-a");
  });
});

describe("accountAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns UNAUTHENTICATED when there is no session", async () => {
    mocks.getSession.mockResolvedValue(null);
    const action = accountAction(async () => ({ ok: true }));
    await expect(action()).resolves.toEqual({ error: "UNAUTHENTICATED" });
  });

  it("injects ctx.userId from the verified session", async () => {
    mocks.getSession.mockResolvedValue(verifiedSession("user-a"));
    const action = accountAction(async (ctx) => ({ userId: ctx.userId }));
    await expect(action()).resolves.toEqual({ userId: "user-a" });
  });

  it("masks unexpected internal errors", async () => {
    mocks.getSession.mockResolvedValue(verifiedSession("user-a"));
    const action = accountAction(async () => {
      throw new Error('relation "signals" does not exist');
    });
    await expect(action()).resolves.toEqual({
      error: "An unexpected error occurred",
    });
  });

  it("passes through UserFacingError messages", async () => {
    mocks.getSession.mockResolvedValue(verifiedSession("user-a"));
    const action = accountAction(async () => {
      throw new UserFacingError("Something the user should see");
    });
    await expect(action()).resolves.toEqual({
      error: "Something the user should see",
    });
  });

  it("runWithContext throws (does not mask) so cron callers can format", async () => {
    const action = accountAction(async () => {
      throw new UserFacingError("boom");
    });
    const ctx = {
      userId: "user-a",
      // biome-ignore lint/suspicious/noExplicitAny: minimal injected context
    } as any;
    await expect(action.runWithContext(ctx)).rejects.toBeInstanceOf(
      UserFacingError,
    );
  });
});
