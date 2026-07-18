import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/env/server";
import * as schema from "./schema";

// postgres-js driver works for both local Postgres and hosted providers
// (Neon/Supabase) over TCP. `prepare: false` keeps it compatible with
// transaction-pooling proxies (PgBouncer/Neon pooled endpoints). The client is
// lazy — no connection is opened until the first query.
const client = postgres(env.DATABASE_URL, { prepare: false });

export const db = drizzle(client, { schema });
