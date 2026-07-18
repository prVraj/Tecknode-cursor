import {
  buildTopPagesResponse,
  type CompetitorTopPages,
  fetchDataForSeoRankedKeywords,
} from "@/lib/dataforseo";
import { signalSnapshotRepo } from "@/server/db/repos/signal-snapshot.repo";
import type { NewSignal } from "@/server/db/schema";
import type { ModuleRunner } from "../dispatcher";
import {
  asOutput,
  getCompetitorDomains,
  getDataForSeoCredentials,
  getLocation,
  getLocationLabel,
  getNumberPayload,
} from "./module-helpers";

// A page must clear this estimated monthly traffic to count as a "winning"
// launch worth alerting on — filters out the long tail of trivial new URLs.
const MIN_TRAFFIC_TO_ALERT = 100;
// Cap how many new pages we name per competitor in a single alert.
const MAX_NAMED_PAGES = 5;

/** Prior top-page URLs grouped by competitor domain, for new-page diffing. */
function priorUrlsByDomain(
  payload: Record<string, unknown> | undefined,
): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  const competitors = payload?.competitors;
  if (!Array.isArray(competitors)) return map;
  for (const comp of competitors as CompetitorTopPages[]) {
    if (!(comp?.domain && Array.isArray(comp.pages))) continue;
    map.set(comp.domain, new Set(comp.pages.map((p) => p.url)));
  }
  return map;
}

export const runSeoTopPages: ModuleRunner = async ({ userId, entity, run }) => {
  const { login, password } = getDataForSeoCredentials("seo_top_pages");
  const competitorDomains = await getCompetitorDomains({
    userId,
    entity,
  });
  const location = getLocation(entity);
  const dataIssues: string[] = [];

  const results = await Promise.allSettled(
    competitorDomains.map((domain) =>
      fetchDataForSeoRankedKeywords({
        domain,
        location,
        login,
        password,
        limit: 1000,
      }),
    ),
  );

  const output = buildTopPagesResponse({
    competitorDomains,
    results,
    location: getLocationLabel(entity),
    limit: getNumberPayload(entity, "limit", 20),
    dataIssues,
  });

  // Diff this run's top pages against the prior snapshot to surface NEW
  // high-traffic pages a competitor has broken into the rankings with.
  const prev = await signalSnapshotRepo.findLatest(entity.id, "seo_top_pages");
  const priorByDomain = priorUrlsByDomain(prev?.payload);
  const today = new Date().toISOString().slice(0, 10);
  const signals: NewSignal[] = [];

  if (!prev) {
    const tracked = output.competitors.reduce(
      (sum, comp) => sum + comp.pages.length,
      0,
    );
    if (tracked > 0) {
      signals.push({
        userId,
        subjectEntityId: entity.id,
        capabilityKey: "seo_top_pages",
        severity: "p3",
        title: `Tracking ${tracked} competitor top pages by estimated traffic`,
        summary: `Baseline across ${output.competitors.length} competitor(s); future runs flag new high-traffic pages.`,
        evidence: {
          runId: run.id,
          details: { baseline: true, trackedPages: tracked },
        },
        confidence: "0.75",
        dedupKey: `seo_top_pages:${entity.id}:baseline`,
      });
    }
  } else {
    for (const comp of output.competitors) {
      const priorUrls = priorByDomain.get(comp.domain);
      if (!priorUrls) continue; // first time we have data for this competitor
      const newPages = comp.pages
        .filter(
          (p) =>
            !priorUrls.has(p.url) &&
            (p.estimatedTraffic ?? 0) >= MIN_TRAFFIC_TO_ALERT,
        )
        .sort((a, b) => (b.estimatedTraffic ?? 0) - (a.estimatedTraffic ?? 0));
      if (newPages.length === 0) continue;

      const top = newPages[0];
      signals.push({
        userId,
        subjectEntityId: entity.id,
        capabilityKey: "seo_top_pages",
        severity: "p2",
        title: `${comp.domain} broke ${newPages.length} new page(s) into top traffic`,
        summary: `Top new entry: ${top.url} (~${top.estimatedTraffic} est. monthly visits${top.topKeyword ? `, "${top.topKeyword}"` : ""}).`,
        evidence: {
          sourceUrl: top.url,
          runId: run.id,
          details: {
            domain: comp.domain,
            newPages: newPages.slice(0, MAX_NAMED_PAGES).map((p) => ({
              url: p.url,
              estimatedTraffic: p.estimatedTraffic,
              topKeyword: p.topKeyword,
            })),
            newPageCount: newPages.length,
          },
        },
        confidence: "0.7",
        dedupKey: `seo_top_pages:${entity.id}:${comp.domain}:${today}`,
      });
    }
  }

  return { output: asOutput(output), signals, costUnits: 1 };
};
