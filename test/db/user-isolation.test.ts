import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/server/db/schema";

// Spin up an in-memory Postgres, apply the generated migration, and prove that
// user-scoped ownership actually isolates rows — two users tracking the same
// domain must never see each other's data.

let db: ReturnType<typeof drizzle<typeof schema>>;

async function seedUser(id: string) {
  await db.insert(schema.user).values({
    id,
    name: `User ${id}`,
    email: `${id}@example.com`,
    emailVerified: true,
  });
}

beforeAll(async () => {
  const client = new PGlite();
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: "./migrations" });

  await seedUser("user-a");
  await seedUser("user-b");

  // Both users track the exact same domain.
  await db.insert(schema.trackedEntities).values([
    { userId: "user-a", role: "primary", domain: "acme.com" },
    { userId: "user-b", role: "primary", domain: "acme.com" },
  ]);
});

describe("user isolation", () => {
  it("scopes tracked entities to the owning user", async () => {
    const aRows = await db
      .select()
      .from(schema.trackedEntities)
      .where(eq(schema.trackedEntities.userId, "user-a"));

    expect(aRows).toHaveLength(1);
    expect(aRows[0].userId).toBe("user-a");
    expect(aRows[0].domain).toBe("acme.com");
  });

  it("does not leak another user's rows for the same domain", async () => {
    const bRows = await db
      .select()
      .from(schema.trackedEntities)
      .where(eq(schema.trackedEntities.userId, "user-b"));

    expect(bRows).toHaveLength(1);
    expect(bRows[0].userId).toBe("user-b");
    expect(bRows.every((r) => r.userId !== "user-a")).toBe(true);
  });

  it("allows the same domain across users (per-user unique, not global)", async () => {
    const all = await db.select().from(schema.trackedEntities);
    const acme = all.filter((r) => r.domain === "acme.com");
    expect(acme).toHaveLength(2);
    expect(new Set(acme.map((r) => r.userId))).toEqual(
      new Set(["user-a", "user-b"]),
    );
  });

  it("cascades entity deletion when a user is removed", async () => {
    await db.delete(schema.user).where(eq(schema.user.id, "user-a"));
    const remaining = await db.select().from(schema.trackedEntities);
    expect(remaining.every((r) => r.userId === "user-b")).toBe(true);
  });
});
