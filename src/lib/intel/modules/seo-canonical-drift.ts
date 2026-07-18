import { fetchPageHead } from "@/lib/seo/fetch-page-head";
import { normalizeUrlForCompare } from "@/lib/seo/url-compare";
import { signalSnapshotRepo } from "@/server/db/repos/signal-snapshot.repo";
import type { NewSignal } from "@/server/db/schema";
import type { ModuleRunner, ModuleRunResult } from "../dispatcher";
import { getMoneyPageUrls } from "./module-helpers";

/**
 * seo_canonical_drift — detects money pages whose `<link rel="canonical">`
 * points away from the page itself (primary entity). A canonical pointing at a
 * different URL tells Google to index that other URL instead — a common, silent
 * cause of pages dropping out of the index (e.g. a templating bug canonicalizing
 * every page to the homepage). We flag pages whose canonical differs from their
 * own (post-redirect) URL, and alert on NEW drift.
 */

export const runSeoCanonicalDrift: ModuleRunner = async ({
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
    // Drift = a canonical exists AND resolves to a different page identity than
    // the page's own (post-redirect) URL. Missing canonical is not drift.
    const drifted =
      !!head.canonical &&
      normalizeUrlForCompare(head.canonical) !==
        normalizeUrlForCompare(head.finalUrl);
    return {
      url: head.url,
      canonical: head.canonical,
      drifted,
    };
  });

  const driftedPages = pages.filter((p) => p.drifted).map((p) => p.url);

  const prev = await signalSnapshotRepo.findLatest(
    entity.id,
    "seo_canonical_drift",
  );
  const prevDrifted: string[] = Array.isArray(prev?.payload?.driftedPages)
    ? (prev.payload.driftedPages as string[])
    : [];
  const newlyDrifted = driftedPages.filter((url) => !prevDrifted.includes(url));

  const signals: NewSignal[] = [];
  if (newlyDrifted.length > 0) {
    const examples = pages
      .filter((p) => newlyDrifted.includes(p.url))
      .slice(0, 3)
      .map((p) => `${p.url} → ${p.canonical}`);
    signals.push({
      userId,
      subjectEntityId: entity.id,
      capabilityKey: "seo_canonical_drift",
      severity: "p2",
      title: `${newlyDrifted.length} page(s) with canonical drift`,
      summary: `Canonical now points elsewhere: ${examples.join("; ")}`,
      evidence: {
        sourceUrl: entity.domain,
        runId: run.id,
        details: { newlyDrifted, allDrifted: driftedPages },
      },
      confidence: "0.85",
      dedupKey: `seo_canonical_drift:${entity.id}`,
    });
  }

  const output: ModuleRunResult["output"] = {
    domain: entity.domain,
    moneyPageCount: moneyPages.length,
    driftCount: driftedPages.length,
    driftedPages,
    newlyDrifted,
    pages,
    dataIssues,
  };

  return { output, signals, costUnits: 0 };
};
