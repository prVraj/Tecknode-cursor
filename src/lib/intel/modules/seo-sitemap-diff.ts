import { fetchSitemapIntel } from "@/lib/intel/sitemap-map";
import { signalSnapshotRepo } from "@/server/db/repos/signal-snapshot.repo";
import type { NewSignal } from "@/server/db/schema";
import { emitDiffSignal } from "../diff/emit-signal";
import { diffSet, hashSet } from "../diff/set";
import type { ModuleRunner, ModuleRunResult } from "../dispatcher";

/**
 * seo_sitemap_diff — sitemap-diff monitor for the org's OWN site (primary
 * entity). Tracks the set of URLs the site publishes via its sitemap and alerts
 * when pages appear or disappear. The new/changed URLs surfaced here are the
 * payload the IndexNow "Fix it" action resubmits.
 *
 * Mirrors comp-sitemap.ts (competitor variant) but gated to role === "primary".
 *
 * Diff strategy (P1-1 fix — chose option B + option A hash short-circuit):
 * The snapshot persists the FULL sorted URL set (`urlSet`) plus a
 * `urlSetHash`, and separately keeps `urls.slice(0, 50)` for UI display only.
 * Previously the diff compared the full fetched set against `urls.slice(0, 50)`
 * from the prior snapshot, so any site with >50 URLs reported false new/removed
 * URLs on every subsequent run. Option A (hash only) can tell us *that* the set
 * changed but not *what* changed, so it can't produce accurate new/removed
 * lists on its own — we need the full prior set anyway. Firecrawl caps the map
 * at 200 URLs, so the JSONB payload stays tiny. The hash lets us cheaply skip
 * the set diff when nothing changed.
 */

// Alert only when the structural change is non-trivial — avoids noise from a
// single page being added/removed during routine publishing.
const CHANGE_THRESHOLD = 5;

/** UI / signal evidence — never used for diffing or IndexNow payloads. */
const DISPLAY_URL_LIMIT = 50;

/** Firecrawl map cap — max URLs in actionable IndexNow payload. */
const ACTIONABLE_URL_LIMIT = 200;

export const runSeoSitemapDiff: ModuleRunner = async ({
  userId,
  entity,
  run,
}) => {
  if (entity.role !== "primary") {
    return {
      output: { skipped: true, reason: "entity is not primary" },
      signals: [],
      costUnits: 0,
    };
  }

  const result = await fetchSitemapIntel(entity.domain);
  if (!result.ok) throw new Error(result.reason);

  const { data } = result;
  // Dedupe before sorting/diffing — a sitemap can list a URL more than once
  // (index files, alternate metadata), which would otherwise inflate change
  // counts and leave duplicates in the persisted set and IndexNow payload.
  const sortedUrls = Array.from(new Set(data.urls)).sort();
  const urlSetHash = hashSet(sortedUrls);

  const prev = await signalSnapshotRepo.findLatest(
    entity.id,
    "seo_sitemap_diff",
  );
  // Read the FULL prior URL set for an accurate diff. `urlSet` is the source of
  // truth; fall back to the legacy truncated `urls` only for pre-fix snapshots
  // (self-heals after one run since we now persist `urlSet`).
  const prevUrls: string[] = Array.isArray(prev?.payload?.urlSet)
    ? (prev.payload.urlSet as string[])
    : Array.isArray(prev?.payload?.urls)
      ? (prev.payload.urls as string[])
      : [];
  const prevHash =
    typeof prev?.payload?.urlSetHash === "string"
      ? (prev.payload.urlSetHash as string)
      : null;

  // Short-circuit when the hash proves the set is unchanged (option A).
  const unchanged = prevHash != null && prevHash === urlSetHash;
  let newUrls: string[] = [];
  let removedUrls: string[] = [];
  if (prev && !unchanged) {
    const { added, removed } = diffSet(prevUrls, sortedUrls);
    newUrls = added;
    removedUrls = removed;
  }

  const signals: NewSignal[] = [];
  const dedupKey = `seo_sitemap_diff:${entity.id}`;

  if (!prev) {
    signals.push(
      emitDiffSignal({
        userId,
        entityId: entity.id,
        dedupKey,
        capabilityKey: "seo_sitemap_diff",
        severity: "p3",
        title: `Sitemap baseline: ${data.totalCount} URLs`,
        summary: `Tracking ${data.totalCount} published URLs for ${entity.domain}.`,
        sourceUrl: `https://${entity.domain}`,
        runId: run.id,
        details: { baseline: true, totalCount: data.totalCount },
      }),
    );
  } else if (
    newUrls.length >= CHANGE_THRESHOLD ||
    removedUrls.length >= CHANGE_THRESHOLD
  ) {
    signals.push(
      emitDiffSignal({
        userId,
        entityId: entity.id,
        dedupKey,
        capabilityKey: "seo_sitemap_diff",
        severity: "p2",
        title: `Sitemap changed: +${newUrls.length} / -${removedUrls.length} URLs`,
        summary:
          newUrls.length > 0
            ? `New: ${newUrls.slice(0, 3).join(", ")}`
            : `Removed: ${removedUrls.slice(0, 3).join(", ")}`,
        sourceUrl: `https://${entity.domain}`,
        runId: run.id,
        details: {
          newUrls: newUrls.slice(0, 10),
          removedUrls: removedUrls.slice(0, 10),
          newCount: newUrls.length,
          removedCount: removedUrls.length,
          totalCount: data.totalCount,
        },
        confidence: "0.8",
      }),
    );
  }

  const actionableNewUrls = newUrls.slice(0, ACTIONABLE_URL_LIMIT);
  const actionableRemovedUrls = removedUrls.slice(0, ACTIONABLE_URL_LIMIT);
  const truncated =
    newUrls.length > ACTIONABLE_URL_LIMIT ||
    removedUrls.length > ACTIONABLE_URL_LIMIT;

  const output: ModuleRunResult["output"] = {
    schemaVersion: 1,
    domain: entity.domain,
    totalCount: data.totalCount,
    // Truncated for UI display only — never used for diffing.
    urls: sortedUrls.slice(0, DISPLAY_URL_LIMIT),
    // Full sorted URL set + hash — the source of truth for the next run's diff.
    urlSet: sortedUrls,
    urlSetHash,
    // Full diff for IndexNow / intel_actions — capped at Firecrawl map limit.
    actionable: {
      newUrls: actionableNewUrls,
      removedUrls: actionableRemovedUrls,
    },
    truncated,
    // Legacy display slices — prefer `actionable` for write actions.
    newUrls: newUrls.slice(0, DISPLAY_URL_LIMIT),
    removedUrls: removedUrls.slice(0, DISPLAY_URL_LIMIT),
    newUrlCount: newUrls.length,
    removedUrlCount: removedUrls.length,
    dataIssues: data.totalCount === 0 ? ["no URLs returned from sitemap"] : [],
  };

  return {
    output,
    signals,
    costUnits: Math.ceil(result.cost / 0.01),
  };
};
