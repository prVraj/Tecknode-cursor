import {
  buildTrafficTrendResponse,
  type CompetitorTrafficSummary,
  fetchDataForSeoDomainOverview,
  fetchDataForSeoHistoricalOverview,
} from "@/lib/dataforseo";
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

/**
 * Period label for a competitor's most recent traffic data point, used to scope
 * the dedupKey so a sustained MoM swing alerts once per month, not every run.
 */
function periodFor(summary: CompetitorTrafficSummary): string {
  const last = summary.history.at(-1);
  if (last) return `${last.year}-${String(last.month).padStart(2, "0")}`;
  return "current";
}

export const runSeoTrafficTrend: ModuleRunner = async ({
  userId,
  entity,
  run,
}) => {
  const { login, password } = getDataForSeoCredentials("seo_traffic_trend");
  const competitorDomains = await getCompetitorDomains({
    userId,
    entity,
  });
  const location = getLocation(entity);
  const dataIssues: string[] = [];

  const [overviewResults, historicalResults] = await Promise.all([
    Promise.allSettled(
      competitorDomains.map((domain) =>
        fetchDataForSeoDomainOverview({ domain, location, login, password }),
      ),
    ),
    Promise.allSettled(
      competitorDomains.map((domain) =>
        fetchDataForSeoHistoricalOverview({
          domain,
          location,
          login,
          password,
        }),
      ),
    ),
  ]);

  const output = buildTrafficTrendResponse({
    competitorDomains,
    overviewResults,
    historicalResults,
    location: getLocationLabel(entity),
    alertThresholdPercent: getNumberPayload(
      entity,
      "alertThresholdPercent",
      15,
    ),
    dataIssues,
  });

  // Alert on competitors whose estimated organic traffic swung past the
  // threshold MoM. A decline is an opening for us; a spike is a momentum
  // warning — both are p2 and worth a human glance.
  const signals: NewSignal[] = [];
  for (const summary of output.competitors) {
    if (!summary.alert || summary.momChange === null) continue;
    const declining = summary.momChange < 0;
    const pct = Math.abs(Math.round(summary.momChange));
    signals.push({
      userId,
      subjectEntityId: entity.id,
      capabilityKey: "seo_traffic_trend",
      severity: "p2",
      title: declining
        ? `${summary.domain} organic traffic down ${pct}% MoM`
        : `${summary.domain} organic traffic up ${pct}% MoM`,
      summary: declining
        ? `Competitor losing organic visibility (~${summary.currentOrganicTraffic ?? "?"} est. monthly visits) — opening to capture share.`
        : `Competitor gaining organic momentum (~${summary.currentOrganicTraffic ?? "?"} est. monthly visits).`,
      evidence: {
        sourceUrl: `https://${summary.domain}`,
        runId: run.id,
        details: {
          domain: summary.domain,
          momChange: summary.momChange,
          trend: summary.trend,
          currentOrganicTraffic: summary.currentOrganicTraffic,
          currentOrganicKeywords: summary.currentOrganicKeywords,
        },
      },
      confidence: "0.7",
      dedupKey: `seo_traffic_trend:${entity.id}:${summary.domain}:${periodFor(summary)}`,
    });
  }

  return { output: asOutput(output), signals, costUnits: 1 };
};
