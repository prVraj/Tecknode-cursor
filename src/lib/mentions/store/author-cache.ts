/**
 * In-process TTL cache for per-author / per-resource profile lookups.
 *
 * Follower / subscriber / view counts are NOT in platform search payloads
 * (GitHub, Bluesky, YouTube) — they need an extra call. The same author
 * appears in many mentions and across repeated scans, so without this every
 * scan re-fetches identical profiles and burns quota (YouTube especially).
 *
 * Test-grade: module-level Map, single process. Production swaps the Map for
 * the persistence layer (store followerCount on the author record).
 */

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

type Entry<T> = { value: T; expiresAt: number };

const store = new Map<string, Entry<unknown>>();

/**
 * Returns the cached value for `key`, or runs `fetcher` once, caches it, and
 * returns it. A fetcher that throws is NOT cached (so transient failures retry
 * next time) and the error propagates to the caller.
 */
export async function getOrFetch<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlMs: number = DEFAULT_TTL_MS,
): Promise<T> {
  const hit = store.get(key);
  if (hit && Date.now() < hit.expiresAt) {
    return hit.value as T;
  }
  const value = await fetcher();
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
  return value;
}

/** Seed the cache directly (e.g. values already present in a batch response). */
export function primeCache<T>(
  key: string,
  value: T,
  ttlMs: number = DEFAULT_TTL_MS,
): void {
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

/**
 * Non-fetching lookup for batch flows: returns `{ hit: true, value }` if a
 * fresh entry exists, else `{ hit: false }`. Lets a caller collect cache
 * misses and resolve them in one batched request.
 */
export function peekCache<T>(
  key: string,
): { hit: true; value: T } | { hit: false } {
  const e = store.get(key);
  if (e && Date.now() < e.expiresAt) return { hit: true, value: e.value as T };
  return { hit: false };
}
