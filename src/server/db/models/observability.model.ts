import { sql } from "drizzle-orm";
import {
  bigint,
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { user } from "./auth.model";
import { connectorRuns, trackedEntities } from "./intel.model";

/** Provider enum — kept as a text column rather than a pg enum so we can ship
 *  new providers without a schema migration. */
export const API_USAGE_PROVIDERS = [
  "dataforseo",
  "openrouter",
  "firecrawl",
  "apify",
  "youtube",
  "twitter",
  "mxtoolbox",
  "github",
  "serper",
  "other",
] as const;
export type ApiUsageProvider = (typeof API_USAGE_PROVIDERS)[number];

export const API_USAGE_UNIT_TYPES = [
  "task",
  "token",
  "credit",
  "quota",
  "compute_unit",
  "lookup",
  "request",
] as const;
export type ApiUsageUnitType = (typeof API_USAGE_UNIT_TYPES)[number];

export const API_USAGE_STATUSES = ["success", "error", "empty"] as const;
export type ApiUsageStatus = (typeof API_USAGE_STATUSES)[number];

/**
 * Cost source distinguishes "the provider told us this exact USD amount" from
 * "we estimated it from a local price table."
 */
export const API_USAGE_COST_SOURCES = ["body", "table", "unknown"] as const;
export type ApiUsageCostSource = (typeof API_USAGE_COST_SOURCES)[number];

/**
 * Per-call telemetry for every paid (or paid-tier) third-party API the intel
 * pipeline hits. One row per logical fetch — retries record their own rows.
 * Cost is stored in micro-USD (10^-6 USD) to avoid float drift.
 */
export const apiUsageEvents = pgTable(
  "api_usage_events",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    entityId: text("entity_id").references(() => trackedEntities.id, {
      onDelete: "set null",
    }),
    runId: text("run_id").references(() => connectorRuns.id, {
      onDelete: "set null",
    }),
    capabilityKey: text("capability_key"),
    provider: text("provider", { enum: API_USAGE_PROVIDERS }).notNull(),
    operation: text("operation").notNull(),
    units: integer("units").notNull().default(0),
    unitType: text("unit_type", { enum: API_USAGE_UNIT_TYPES }).notNull(),
    costMicroUsd: bigint("cost_micro_usd", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    costSource: text("cost_source", { enum: API_USAGE_COST_SOURCES })
      .notNull()
      .default("unknown"),
    durationMs: integer("duration_ms").notNull().default(0),
    status: text("status", { enum: API_USAGE_STATUSES }).notNull(),
    errorCode: text("error_code"),
    httpStatus: smallint("http_status"),
    attempt: smallint("attempt").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("api_usage_provider_created_at_idx").on(
      table.provider,
      table.createdAt,
    ),
    index("api_usage_user_created_at_idx").on(table.userId, table.createdAt),
    index("api_usage_capability_created_at_idx").on(
      table.capabilityKey,
      table.createdAt,
    ),
    index("api_usage_run_id_idx").on(table.runId),
  ],
);

export type ApiUsageEvent = typeof apiUsageEvents.$inferSelect;
export type NewApiUsageEvent = typeof apiUsageEvents.$inferInsert;
