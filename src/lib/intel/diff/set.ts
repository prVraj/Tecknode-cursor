import { createHash } from "node:crypto";
import type { DiffSetResult } from "./types";

/**
 * Stable SHA-256 (hex) fingerprint of a set of strings. Deduplicates and sorts
 * first so the hash is a true set fingerprint — order- and duplicate-
 * independent — then joins with `\n`. For a duplicate-free input this is
 * byte-for-byte identical to the `hashUrlSet(sortedUrls)` the sitemap modules
 * used (P1-1), so existing `urlSetHash` values stay compatible.
 */
export function hashSet(members: string[]): string {
  const sorted = [...new Set(members)].sort();
  return createHash("sha256").update(sorted.join("\n")).digest("hex");
}

/**
 * Diff two sets of strings. Inputs are treated as sets: `added` and `removed`
 * are deduplicated, each preserving the first-occurrence order of its source
 * (`next` for `added`, `prev` for `removed`) so downstream `.slice(0, n)`
 * summaries stay stable. A duplicate member never inflates the change counts.
 */
export function diffSet(prev: string[], next: string[]): DiffSetResult {
  const prevSet = new Set(prev);
  const nextSet = new Set(next);
  return {
    added: [...nextSet].filter((m) => !prevSet.has(m)),
    removed: [...prevSet].filter((m) => !nextSet.has(m)),
  };
}
