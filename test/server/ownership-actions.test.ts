import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/server/db/schema";

// Prove the ownership contract end-to-end: every account-scoped action gates on
// the *verified session's* userId, so a signed-in attacker (user-b) who forges
// another user's (user-a) record IDs gets a bare "Not found" — never the row,
// never a hint that it exists. Only the session is faked here; the DB boundary
// is a real in-memory Postgres, so the `AND user_id = <caller>` filter is
// exercised by actual SQL, not a re-implemented mock.

const mocks = vi.hoisted(() => {
  process.env.SKIP_ENV_VALIDATION = "true";
  return {
    getSession: vi.fn(),
    // Mutable holder so the mocked `db` export resolves to the real pglite
    // instance created asynchronously in beforeAll.
    dbHolder: { current: null as unknown },
  };
});

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: mocks.getSession } },
}));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("@/server/db", () => ({
  get db() {
    return mocks.dbHolder.current;
  },
}));

import {
  getSignalAction,
  listSignalsAction,
  removeTrackedEntityAction,
  submitSignalFeedbackAction,
} from "@/server/actions/intel.actions";
import { getConversationAction } from "@/server/actions/intel-chat.actions";
import { getDigestAction } from "@/server/actions/intel-digest.actions";

let db: ReturnType<typeof drizzle<typeof schema>>;
const ids = {
  entity: "",
  signal: "",
  digest: "",
  conversation: "",
};

function signedInAs(userId: string) {
  mocks.getSession.mockResolvedValue({
    user: {
      id: userId,
      name: `User ${userId}`,
      email: `${userId}@example.com`,
      emailVerified: true,
    },
    session: { id: `sess-${userId}`, userId },
  });
}

beforeAll(async () => {
  const client = new PGlite();
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: "./migrations" });
  mocks.dbHolder.current = db;

  await db.insert(schema.user).values([
    { id: "user-a", name: "A", email: "a@example.com", emailVerified: true },
    { id: "user-b", name: "B", email: "b@example.com", emailVerified: true },
  ]);

  // Everything below belongs to user-a. user-b owns nothing.
  const [entity] = await db
    .insert(schema.trackedEntities)
    .values({ userId: "user-a", role: "primary", domain: "acme.com" })
    .returning();
  ids.entity = entity.id;

  const [signal] = await db
    .insert(schema.signals)
    .values({
      userId: "user-a",
      subjectEntityId: entity.id,
      capabilityKey: "seo_rank",
      title: "Rank dropped",
      evidence: { runId: "run-1" },
      dedupKey: "dedup-a-1",
    })
    .returning();
  ids.signal = signal.id;

  const now = new Date();
  const [digest] = await db
    .insert(schema.digestRuns)
    .values({
      userId: "user-a",
      periodStart: new Date(now.getTime() - 86400000),
      periodEnd: now,
    })
    .returning();
  ids.digest = digest.id;

  const [conversation] = await db
    .insert(schema.intelConversations)
    .values({ userId: "user-a", title: "A's thread" })
    .returning();
  ids.conversation = conversation.id;
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("forged foreign IDs leak nothing (signed in as user-b)", () => {
  beforeEach(() => signedInAs("user-b"));

  it("getSignalAction → Not found for another user's signal", async () => {
    const res = await getSignalAction({ signalId: ids.signal });
    expect(res).toEqual({ error: "Not found" });
  });

  it("getDigestAction → Not found for another user's digest", async () => {
    const res = await getDigestAction({ digestId: ids.digest });
    expect(res).toEqual({ error: "Not found" });
  });

  it("getConversationAction → Not found for another user's conversation", async () => {
    const res = await getConversationAction({
      conversationId: ids.conversation,
    });
    expect(res).toEqual({ error: "Not found" });
  });

  it("removeTrackedEntityAction → Not found and does NOT delete the row", async () => {
    const res = await removeTrackedEntityAction({ entityId: ids.entity });
    expect(res).toEqual({ error: "Not found" });

    const stillThere = await db
      .select()
      .from(schema.trackedEntities)
      .where(eq(schema.trackedEntities.id, ids.entity));
    expect(stillThere).toHaveLength(1);
    expect(stillThere[0].userId).toBe("user-a");
  });

  it("submitSignalFeedbackAction → Not found and writes no feedback row", async () => {
    const res = await submitSignalFeedbackAction({
      signalId: ids.signal,
      rating: "up",
    });
    expect(res).toEqual({ error: "Not found" });

    const feedback = await db
      .select()
      .from(schema.signalFeedback)
      .where(eq(schema.signalFeedback.signalId, ids.signal));
    expect(feedback).toHaveLength(0);
  });

  it("listSignalsAction → returns only the caller's rows (empty for user-b)", async () => {
    const res = await listSignalsAction({});
    expect(Array.isArray(res)).toBe(true);
    expect(res).toHaveLength(0);
  });
});

describe("owner retains access (signed in as user-a)", () => {
  beforeEach(() => signedInAs("user-a"));

  it("getSignalAction returns the owned signal", async () => {
    const res = await getSignalAction({ signalId: ids.signal });
    expect(res).toMatchObject({ id: ids.signal, userId: "user-a" });
  });

  it("listSignalsAction returns the owner's signal", async () => {
    const res = await listSignalsAction({});
    expect(res).toHaveLength(1);
    expect((res as { id: string }[])[0].id).toBe(ids.signal);
  });
});
