import dotenv from "dotenv";
import { defineConfig } from "drizzle-kit";

// .env.local overrides .env when both exist.
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is required — set it in .env or .env.local before running drizzle-kit",
  );
}

export default defineConfig({
  schema: "./src/server/db/schema.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  verbose: true,
  strict: true,
});
