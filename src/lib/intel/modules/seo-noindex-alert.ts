import { fetchPageHead } from "@/lib/seo/fetch-page-head";
import { signalSnapshotRepo } from "@/server/db/repos/signal-snapshot.repo";
import type { NewSignal } from "@/server/db/schema";
import type { ModuleRunner, ModuleRunResult } from "../dispatcher";
import { getMoneyPageUrls } from "./module-helpers";

/**
 * seo_noindex_alert — catches accidental `noindex` on money pages (primary
 * entity). The classic incident is a staging `<meta name="robots"
 * content="noindex">` or `X-Robots-Tag: noindex` header shipping to production,
 * silently dropping pages from the index. We crawl each money page, record its
 * robots directive, and raise a p1 when a page NEWLY goes noindex.
 */

export const runSeoNoindexAlert: ModuleRunner = async ({
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

  const moneyPages = getMoneyPageUrls(entity);
  const heads = await Promise.all(moneyPages.map((url) => fetchPageHead(url)));

  const dataIssues: string[] = [];
  const pages = heads.map((head) => {
    if (head.error) dataIssues.push(`${head.url}: ${head.error}`);
    return {
      url: head.url,
      noindex: head.noindex,
      source: head.noindexSource,
      robots: head.robots,
      statusCode: head.statusCode,
    };
  });

  const noindexPages = pages.filter((p) => p.noindex).map((p) => p.url);

  // Diff against the prior snapshot so we only alert on NEW noindex pages.
  const prev = await signalSnapshotRepo.findLatest(
    entity.id,
    "seo_noindex_alert",
  );
  const prevNoindex: string[] = Array.isArray(prev?.payload?.noindexPages)
    ? (prev.payload.noindexPages as string[])
    : [];
  const newlyNoindex = noindexPages.filter((url) => !prevNoindex.includes(url));

  const signals: NewSignal[] = [];
  if (newlyNoindex.length > 0) {
    signals.push({
      userId,
      subjectEntityId: entity.id,
      capabilityKey: "seo_noindex_alert",
      severity: "p1",
      title: `${newlyNoindex.length} page(s) newly set to noindex`,
      summary: `These money pages now block indexing: ${newlyNoindex
        .slice(0, 3)
        .join(", ")}. Check for an accidental noindex deploy.`,
      evidence: {
        sourceUrl: entity.domain,
        runId: run.id,
        details: { newlyNoindex, allNoindex: noindexPages },
      },
      confidence: "0.9",
      dedupKey: `seo_noindex_alert:${entity.id}`,
    });
  }

  const output: ModuleRunResult["output"] = {
    domain: entity.domain,
    moneyPageCount: moneyPages.length,
    noindexCount: noindexPages.length,
    noindexPages,
    newlyNoindex,
    pages,
    dataIssues,
  };

  return { output, signals, costUnits: 0 };
};
