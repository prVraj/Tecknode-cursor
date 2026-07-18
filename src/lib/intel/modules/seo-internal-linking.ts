import { crawl } from "@/lib/intel/clients/firecrawl";
import { normalizeUrlForCompare } from "@/lib/seo/url-compare";
import { signalSnapshotRepo } from "@/server/db/repos/signal-snapshot.repo";
import type { NewSignal } from "@/server/db/schema";
import type { ModuleRunner, ModuleRunResult } from "../dispatcher";
import { getEntityUrl } from "./module-helpers";

/**
 * seo_internal_linking — internal-linking gaps on the primary site. Crawls the
 * site, builds an inbound-link graph across the crawled pages, and flags
 * orphan pages (zero internal inbound links) and under-linked money pages.
 * Orphans rank worse and are crawled less; an orphaned pricing/product page is
 * a direct revenue leak.
 */

const MAX_CRAWL_PAGES = 40;
const MAX_ORPHANS_LISTED = 15;
// Pages whose path looks revenue-critical — an orphan here is escalated to p1.
const MONEY_PAGE_RE =
  /\/(pricing|plans|product|products|features|demo|signup|sign-up|get-started|buy|checkout)(\/|$)/i;

export const runSeoInternalLinking: ModuleRunner = async ({
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

  const entryUrl = getEntityUrl(entity);
  let origin: string;
  try {
    origin = new URL(entryUrl).origin;
  } catch {
    origin = `https://${entity.domain}`;
  }
  const sameOrigin = (url: string): boolean => {
    try {
      return new URL(url).origin === origin;
    } catch {
      return false;
    }
  };

  const outcome = await crawl(entryUrl, MAX_CRAWL_PAGES);
  const pages = outcome.data.filter(
    (p) => p.sourceURL && sameOrigin(p.sourceURL),
  );

  if (pages.length < 2) {
    return {
      output: {
        source: "firecrawl",
        pagesAnalyzed: pages.length,
        orphanCount: 0,
        orphans: [],
        dataIssues: ["too few pages crawled to analyze internal linking"],
      },
      signals: [],
      costUnits: Math.max(1, outcome.data.length),
    };
  }

  // Map normalized key → a readable original URL, and init inbound counts.
  const original = new Map<string, string>();
  const inbound = new Map<string, number>();
  for (const page of pages) {
    const key = normalizeUrlForCompare(page.sourceURL as string);
    if (!original.has(key)) original.set(key, page.sourceURL as string);
    if (!inbound.has(key)) inbound.set(key, 0);
  }

  // Count internal inbound links between crawled pages.
  for (const page of pages) {
    const fromKey = normalizeUrlForCompare(page.sourceURL as string);
    const seen = new Set<string>();
    for (const link of page.links ?? []) {
      if (!sameOrigin(link)) continue;
      const toKey = normalizeUrlForCompare(link);
      if (toKey === fromKey || seen.has(toKey)) continue;
      seen.add(toKey);
      if (inbound.has(toKey)) inbound.set(toKey, (inbound.get(toKey) ?? 0) + 1);
    }
  }

  const entryKey = normalizeUrlForCompare(entryUrl);
  const orphans: string[] = [];
  for (const [key, count] of inbound) {
    if (key === entryKey) continue; // entry page is reached directly
    if (count === 0) orphans.push(original.get(key) ?? key);
  }
  const importantOrphans = orphans.filter((u) => MONEY_PAGE_RE.test(u));
  const totalInbound = [...inbound.values()].reduce((a, b) => a + b, 0);
  const avgInbound =
    inbound.size > 0 ? Math.round((totalInbound / inbound.size) * 10) / 10 : 0;

  const prev = await signalSnapshotRepo.findLatest(
    entity.id,
    "seo_internal_linking",
  );

  const signals: NewSignal[] = [];
  if (importantOrphans.length > 0) {
    signals.push({
      userId,
      subjectEntityId: entity.id,
      capabilityKey: "seo_internal_linking",
      severity: "p1",
      title: `${importantOrphans.length} revenue page(s) have no internal links`,
      summary: `Orphaned money pages: ${importantOrphans.slice(0, 3).join(", ")}. Add internal links from nav/related content to recover crawl + ranking.`,
      evidence: {
        sourceUrl: entryUrl,
        runId: run.id,
        details: {
          importantOrphans,
          orphanCount: orphans.length,
          pagesAnalyzed: pages.length,
        },
      },
      confidence: "0.8",
      dedupKey: `seo_internal_linking:${entity.id}:orphans`,
    });
  } else if (orphans.length > 0) {
    signals.push({
      userId,
      subjectEntityId: entity.id,
      capabilityKey: "seo_internal_linking",
      severity: "p2",
      title: `${orphans.length} orphan page(s) with no internal links`,
      summary: `${orphans.slice(0, 3).join(", ")}. Orphan pages are crawled less and rank worse — link them from related content.`,
      evidence: {
        sourceUrl: entryUrl,
        runId: run.id,
        details: {
          orphans: orphans.slice(0, MAX_ORPHANS_LISTED),
          orphanCount: orphans.length,
          avgInbound,
          pagesAnalyzed: pages.length,
        },
      },
      confidence: "0.75",
      dedupKey: `seo_internal_linking:${entity.id}:orphans`,
    });
  } else if (!prev) {
    signals.push({
      userId,
      subjectEntityId: entity.id,
      capabilityKey: "seo_internal_linking",
      severity: "p3",
      title: `Internal linking healthy across ${pages.length} pages`,
      summary: `No orphan pages; avg ${avgInbound} internal inbound links per page.`,
      evidence: {
        sourceUrl: entryUrl,
        runId: run.id,
        details: { baseline: true, pagesAnalyzed: pages.length, avgInbound },
      },
      confidence: "0.7",
      dedupKey: `seo_internal_linking:${entity.id}:baseline`,
    });
  }

  const output: ModuleRunResult["output"] = {
    source: "firecrawl",
    pagesAnalyzed: pages.length,
    orphanCount: orphans.length,
    orphans: orphans.slice(0, MAX_ORPHANS_LISTED),
    importantOrphans,
    avgInbound,
    partial: outcome.partial,
    dataIssues: outcome.partial ? ["crawl returned partial results"] : [],
  };

  return { output, signals, costUnits: Math.max(1, outcome.data.length) };
};
