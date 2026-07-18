import {
  type BacklinksResponse,
  buildBacklinksResponse,
  fetchDataForSeoBacklinksNewLost,
  fetchDataForSeoBacklinksSummary,
} from "@/lib/dataforseo";
import type { NewSignal } from "@/server/db/schema";
import type { ModuleRunner } from "../dispatcher";
import {
  asOutput,
  getCompetitorDomains,
  getDataForSeoCredentials,
} from "./module-helpers";

// Domain Rank threshold for a "high-DR" link worth alerting on.
const HIGH_DR = 50;
const NEW_LOST_LIMIT = 100;

/**
 * seo_backlink_changes — backlink gains/losses for the org's own domain plus
 * competitor backlink gains (primary entity only). Surfaces new high-DR links
 * (PR/SEO wins), lost links, toxic links (disavow candidates), and high-DR
 * links competitors won that you haven't (`isGap` → outreach targets).
 *
 * PLAN-GATED: the DataForSEO `/v3/backlinks/*` endpoints require the separate
 * Backlinks API subscription. Without it the calls fail and this module returns
 * a graceful baseline with dataIssues — it auto-activates once the plan is on.
 * See docs/signals-deferred.md.
 */
export const runSeoBacklinkChanges: ModuleRunner = async ({
  entity,
  userId,
  run,
}) => {
  if (entity.role !== "primary") {
    return {
      output: { skipped: true, reason: "entity is not primary" },
      signals: [],
      costUnits: 0,
    };
  }

  const { login, password } = getDataForSeoCredentials("seo_backlink_changes");
  const competitors = await getCompetitorDomains({ userId, entity });
  const dataIssues: string[] = [];

  const [summaryResult, newLostResult] = await Promise.allSettled([
    fetchDataForSeoBacklinksSummary({ domain: entity.domain, login, password }),
    fetchDataForSeoBacklinksNewLost({
      domain: entity.domain,
      login,
      password,
      limit: NEW_LOST_LIMIT,
    }),
  ]);

  const competitorNewLostResults = competitors.length
    ? await Promise.allSettled(
        competitors.map((domain) =>
          fetchDataForSeoBacklinksNewLost({
            domain,
            login,
            password,
            limit: NEW_LOST_LIMIT,
          }),
        ),
      )
    : undefined;

  const output: BacklinksResponse = buildBacklinksResponse({
    domain: entity.domain,
    summaryResult,
    newLostResult,
    competitorDomains: competitors.length ? competitors : undefined,
    competitorNewLostResults,
    minDR: HIGH_DR,
    dataIssues,
  });

  const newHighDr = output.newLinks.filter(
    (l) => (l.domainRank ?? 0) >= HIGH_DR,
  );
  const lostHighDr = output.lostLinks.filter(
    (l) => (l.domainRank ?? 0) >= HIGH_DR,
  );
  const competitorGapLinks = (output.competitorGains ?? []).reduce(
    (sum, c) => sum + c.newHighDrLinks.filter((l) => l.isGap).length,
    0,
  );

  const signals: NewSignal[] = [];
  const dedupKey = `seo_backlink_changes:${entity.id}`;
  const today = new Date().toISOString().slice(0, 10);

  // All backlink calls failed (typically: Backlinks API not on the plan).
  const noData =
    summaryResult.status === "rejected" && newLostResult.status === "rejected";

  if (noData) {
    signals.push({
      userId,
      subjectEntityId: entity.id,
      capabilityKey: "seo_backlink_changes",
      severity: "p3",
      title: "Backlink monitoring inactive",
      summary:
        `Backlink data unavailable — DataForSEO Backlinks API not enabled. ${dataIssues[0] ?? ""}`.trim(),
      evidence: { runId: run.id, details: { dataIssues, planGated: true } },
      confidence: "0.5",
      dedupKey,
    });
  } else if (
    newHighDr.length > 0 ||
    lostHighDr.length > 0 ||
    output.toxicCount > 0
  ) {
    const parts: string[] = [];
    if (newHighDr.length) parts.push(`+${newHighDr.length} high-DR link(s)`);
    if (lostHighDr.length) parts.push(`-${lostHighDr.length} high-DR link(s)`);
    if (output.toxicCount) parts.push(`${output.toxicCount} toxic`);
    signals.push({
      userId,
      subjectEntityId: entity.id,
      capabilityKey: "seo_backlink_changes",
      severity: "p2",
      title: `Backlink changes: ${parts.join(", ")}`,
      summary:
        `Referring domains: ${output.summary.referringDomains ?? "?"}. ${competitorGapLinks > 0 ? `${competitorGapLinks} competitor link(s) you don't have.` : ""}`.trim(),
      evidence: {
        runId: run.id,
        details: {
          newHighDr,
          lostHighDr,
          toxicCount: output.toxicCount,
          competitorGapLinks,
          summary: output.summary,
        },
      },
      confidence: "0.8",
      dedupKey: `${dedupKey}:changes:${today}`,
    });
  } else {
    signals.push({
      userId,
      subjectEntityId: entity.id,
      capabilityKey: "seo_backlink_changes",
      severity: "p3",
      title: "Backlink profile baseline captured",
      summary: `${output.summary.totalBacklinks ?? "?"} backlinks across ${output.summary.referringDomains ?? "?"} referring domains. No notable changes.`,
      evidence: { runId: run.id, details: { summary: output.summary } },
      confidence: "0.7",
      dedupKey,
    });
  }

  return {
    output: asOutput(output),
    signals,
    // summary + new/lost for you + one new/lost per competitor.
    costUnits: 2 + competitors.length,
  };
};
