import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/server/db/schema";

// Route-security invariants for the cron + manual-trigger + polling surface:
// - the cron tick route fails closed on a bad/missing CRON_SECRET
// - the manual refresh route requires an authenticated session
// - a forged foreign entityId on refresh never enqueues a run for it
// - the run-status route reports a forged foreign run as "Not found" (not
//   "Forbidden" — which would confirm the row exists)

const mocks = vi.hoisted(() => {
  process.env.SKIP_ENV_VALIDATION = "true";
  return {
    getSession: vi.fn(),
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

const { isCronAuthorized } = await import("@/lib/cron-auth");
const { GET: tickGet } = await import("@/app/api/intel/tick/route");
const { POST: refreshPost } = await import("@/app/api/intel/refresh/route");
const { GET: runGet } = await import("@/app/api/intel/runs/[id]/route");

let db: ReturnType<typeof drizzle<typeof schema>>;
const ids = { entityA: "", entityB: "", runA: "" };

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

function signedOut() {
  mocks.getSession.mockResolvedValue(null);
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

  const [entityA] = await db
    .insert(schema.trackedEntities)
    .values({ userId: "user-a", role: "primary", domain: "acme-a.com" })
    .returning();
  ids.entityA = entityA.id;

  const [entityB] = await db
    .insert(schema.trackedEntities)
    .values({ userId: "user-b", role: "primary", domain: "acme-b.com" })
    .returning();
  ids.entityB = entityB.id;

  const [runA] = await db
    .insert(schema.connectorRuns)
    .values({
      userId: "user-a",
      entityId: entityA.id,
      capabilityKey: "seo_rank",
      connectorKey: "dataforseo",
      status: "pending",
      idempotencyKey: "run-a-key",
    })
    .returning();
  ids.runA = runA.id;
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("cron tick route — fails closed", () => {
  it("401s with no CRON_SECRET configured", () => {
    const original = process.env.CRON_SECRET;
    delete process.env.CRON_SECRET;
    expect(
      isCronAuthorized(new Request("http://localhost/api/intel/tick")),
    ).toBe(false);
    process.env.CRON_SECRET = original;
  });

  it("401s with a wrong bearer token", async () => {
    process.env.CRON_SECRET = "a".repeat(32);
    const res = await tickGet(
      new Request("http://localhost/api/intel/tick", {
        headers: { authorization: "Bearer wrong-secret-wrong-secret-wrong12" },
      }),
    );
    expect(res.status).toBe(401);
  });

  it("401s with a wrong ?token= query param", async () => {
    process.env.CRON_SECRET = "a".repeat(32);
    const res = await tickGet(
      new Request("http://localhost/api/intel/tick?token=nope"),
    );
    expect(res.status).toBe(401);
  });
});

describe("refresh route — requires auth + real ownership", () => {
  it("401s when not signed in", async () => {
    signedOut();
    const res = await refreshPost(
      new Request("http://localhost/api/intel/refresh", {
        method: "POST",
        body: JSON.stringify({
          entityId: ids.entityA,
          capabilityKey: "seo_rank",
        }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("404s and enqueues nothing for a forged foreign entityId", async () => {
    signedInAs("user-b");
    const res = await refreshPost(
      new Request("http://localhost/api/intel/refresh", {
        method: "POST",
        body: JSON.stringify({
          entityId: ids.entityA, // owned by user-a
          capabilityKey: "seo_rank",
        }),
      }),
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ error: "Tracked entity not found" });
  });
});

describe("run-status route — leaks nothing on a foreign id", () => {
  it("401s when not signed in", async () => {
    signedOut();
    const res = await runGet(new Request("http://localhost/api/intel/runs/x"), {
      params: Promise.resolve({ id: ids.runA }),
    });
    expect(res.status).toBe(401);
  });

  it("404s (not 403) for another user's run", async () => {
    signedInAs("user-b");
    const res = await runGet(new Request("http://localhost/api/intel/runs/x"), {
      params: Promise.resolve({ id: ids.runA }),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ error: "Not found" });
  });

  it("200s with the run for its owner", async () => {
    signedInAs("user-a");
    const res = await runGet(new Request("http://localhost/api/intel/runs/x"), {
      params: Promise.resolve({ id: ids.runA }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(ids.runA);
  });
});
