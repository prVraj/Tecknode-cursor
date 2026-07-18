import type { CapabilityKey } from "@/server/db/schema";

/**
 * Builds the stable idempotency key for a connector run. Format:
 *   `<capabilityKey>:<entityId>:<bucket>`
 *
 * We use a calendar-day bucket (UTC) — one run per (entity, capability) per
 * day. Postgres unique index enforces this across retries.
 */
export function buildIdempotencyKey(
  capabilityKey: CapabilityKey,
  entityId: string,
  bucketDate = new Date(),
): string {
  const bucket = bucketDate.toISOString().slice(0, 10); // YYYY-MM-DD UTC
  return `${capabilityKey}:${entityId}:${bucket}`;
}

/** Derive the connector name from category prefix for the retained 64. */
export function connectorKeyFor(capability: CapabilityKey): string {
  if (capability.startsWith("seo_")) return "dataforseo";
  if (capability.startsWith("geo_")) return "openrouter";
  // mentions_*, brand_*, social_*, pr_* — all backed by the mentions scan.
  return "mentions";
}
