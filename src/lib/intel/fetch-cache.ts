import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { env } from "@/env/server";
import { redis } from "@/lib/redis";
import { logExternalFailure } from "@/utils/log-external";
import logger from "@/utils/logger";
import { getIntelRunContext } from "./run-context";

const log = logger.withContext({ module: "intel-fetch-cache" });

/** Cache lifetime in Redis. The UTC-day in the key already forces a daily
 *  refetch; the TTL only bounds memory (slightly over a day for late writes). */
const DEFAULT_TTL_SEC = 26 * 3600;
/** Max gzip'd payload written to Redis. Oversized responses (e.g. full-HTML
 *  scrapes) skip Redis; with no in-process retention they are refetched on a
 *  later non-overlapping call. */
const SIZE_CAP_BYTES = 1_000_000;

type CacheProvider = "firecrawl" | "dataforseo" | "apify" | (string & {});
type CacheResult = "hit" | "miss" | "bypass";
type CacheSource = "inflight" | "redis" | null;

export interface CachedFetchOptions<T> {
  /** External service, e.g. "firecrawl" | "dataforseo" | "apify". */
  provider: CacheProvider;
  /** Call kind within the provider, e.g. "scrape" | "ranked_keywords". */
  resource: string;
  /** Inputs that make this call unique. Must be small + free of secrets —
   *  they are hashed into the key AND logged verbatim. */
  params: Record<string, unknown>;
  /** The real upstream call. Invoked on a full miss (no in-flight call to
   *  join and no Redis hit). */
  fetcher: () => Promise<T>;
  /** Override the Redis TTL (seconds). */
  ttlSec?: number;
}

/**
 * In-flight single-flight registry. Holds only the in-flight Promise (never a
 * resolved value) and the entry is evicted the instant it settles, so no large
 * payloads are retained in RAM. Its sole job is to collapse concurrent callers
 * for the same key — within one drain, sibling signals scraping the same
 * homepage share a single upstream call instead of stampeding it.
 */
const inflight = new Map<string, Promise<unknown>>();

/** Running tally of cache outcomes (in-process). Reset per drain in the runner
 *  so each tick can log its own hit/miss totals. */
const stats = { hitInflight: 0, hitRedis: 0, miss: 0, bypass: 0 };

/** Snapshot of cache outcomes since the last reset, plus derived totals. */
export function getFetchCacheStats(): {
  hitInflight: number;
  hitRedis: number;
  miss: number;
  bypass: number;
  hits: number;
  total: number;
  hitRatePct: number;
} {
  const hits = stats.hitInflight + stats.hitRedis;
  const total = hits + stats.miss;
  return {
    ...stats,
    hits,
    total,
    hitRatePct: total ? Math.round((hits / total) * 100) : 0,
  };
}

/** Zero the tally (call at the start of a drain/cycle). */
export function resetFetchCacheStats(): void {
  stats.hitInflight = 0;
  stats.hitRedis = 0;
  stats.miss = 0;
  stats.bypass = 0;
}

/** Recursive key-sorted stringify so param order can never change the key. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(",")}}`;
}

function buildKey(
  provider: CacheProvider,
  resource: string,
  params: Record<string, unknown>,
): string {
  const hash = createHash("sha256")
    .update(stableStringify(params))
    .digest("hex");
  const utcDay = new Date().toISOString().slice(0, 10);
  return `intel:fc:${provider}:${resource}:${hash}:${utcDay}`;
}

function logCacheEvent(e: {
  provider: CacheProvider;
  resource: string;
  params: Record<string, unknown>;
  key?: string;
  result: CacheResult;
  source: CacheSource;
}): void {
  if (e.result === "bypass") stats.bypass++;
  else if (e.result === "miss") stats.miss++;
  else if (e.source === "inflight") stats.hitInflight++;
  else if (e.source === "redis") stats.hitRedis++;

  const ctx = getIntelRunContext();
  const fields: Record<string, unknown> = {
    "signal.capability": ctx?.capabilityKey ?? "n/a",
    "cache.provider": e.provider,
    "cache.resource": e.resource,
    "cache.params": e.params,
    "cache.result": e.result,
    "cache.source": e.source,
    ...(e.key ? { "cache.key": e.key } : {}),
    ...(ctx
      ? {
          "user.id": ctx.userId,
          entityId: ctx.entityId,
          runId: ctx.runId,
        }
      : {}),
  };
  const msg = `fetch cache ${e.result}${e.source ? `/${e.source}` : ""}`;
  // Per the logging decision: in-flight hits are the highest-frequency event →
  // debug; misses, Redis hits, and bypass → info (always visible).
  if (e.result === "hit" && e.source === "inflight") log.debug(msg, fields);
  else log.info(msg, fields);
}

async function readL2<T>(key: string): Promise<{ hit: boolean; value?: T }> {
  if (!redis) return { hit: false };
  try {
    const stored = await redis.get<{ gz: string }>(key);
    if (!stored?.gz) return { hit: false };
    const json = gunzipSync(Buffer.from(stored.gz, "base64")).toString("utf8");
    return { hit: true, value: JSON.parse(json) as T };
  } catch (err) {
    logExternalFailure("fetch", "fetch-cache.l2Read", err, {
      "cache.key": key,
    });
    return { hit: false };
  }
}

async function writeL2<T>(
  key: string,
  value: T,
  ttlSec: number,
  ctx: { provider: CacheProvider; resource: string },
): Promise<void> {
  if (!redis || value === undefined) return;
  try {
    const gz = gzipSync(Buffer.from(JSON.stringify(value), "utf8"));
    if (gz.length > SIZE_CAP_BYTES) {
      log.debug("fetch cache skip-store (over size cap)", {
        "cache.key": key,
        "cache.bytes": gz.length,
        "cache.provider": ctx.provider,
        "cache.resource": ctx.resource,
      });
      return;
    }
    await redis.set(key, { gz: gz.toString("base64") }, { ex: ttlSec });
  } catch (err) {
    logExternalFailure("fetch", "fetch-cache.l2Write", err, {
      "cache.key": key,
    });
  }
}

/**
 * Read-through cache for an expensive external call. Lookup order:
 * in-flight registry → Redis (Upstash) → `fetcher()` (the real call).
 *
 * - Caches the RAW response (drop-in: callers keep their own transforms).
 * - Cross-user by design: the key has no user id, so the same public domain
 *   fact is shared across all users.
 * - Failures are never cached; `INTEL_FETCH_CACHE_DISABLED=true` bypasses both
 *   the in-flight dedup and Redis; missing/erroring Redis degrades gracefully
 *   to in-flight-dedup-only.
 */
export function cachedFetch<T>(opts: CachedFetchOptions<T>): Promise<T> {
  const {
    provider,
    resource,
    params,
    fetcher,
    ttlSec = DEFAULT_TTL_SEC,
  } = opts;

  if (env.INTEL_FETCH_CACHE_DISABLED === "true") {
    logCacheEvent({
      provider,
      resource,
      params,
      result: "bypass",
      source: null,
    });
    return fetcher();
  }

  const key = buildKey(provider, resource, params);

  const existing = inflight.get(key) as Promise<T> | undefined;
  if (existing) {
    logCacheEvent({
      provider,
      resource,
      params,
      key,
      result: "hit",
      source: "inflight",
    });
    return existing;
  }

  const work = (async (): Promise<T> => {
    const fromRedis = await readL2<T>(key);
    if (fromRedis.hit) {
      logCacheEvent({
        provider,
        resource,
        params,
        key,
        result: "hit",
        source: "redis",
      });
      return fromRedis.value as T;
    }
    logCacheEvent({
      provider,
      resource,
      params,
      key,
      result: "miss",
      source: null,
    });
    const value = await fetcher();
    await writeL2(key, value, ttlSec, { provider, resource });
    return value;
  })();

  // Single-flight: register before any await so concurrent callers reuse
  // `work`. Evict on settle (resolve OR reject) so nothing is retained in RAM —
  // the registry only dedupes overlapping in-flight calls, never serves a
  // resolved value to a later call (Redis does that). The cleanup branch swallows
  // its own rejection (the real one is surfaced via the returned `work`) so an
  // evicted failure never becomes an unhandled rejection.
  inflight.set(key, work);
  work.finally(() => inflight.delete(key)).catch(() => {});
  return work;
}

/** Test-only: clear the in-flight registry between cases. */
export function __clearInflightForTests(): void {
  inflight.clear();
}
