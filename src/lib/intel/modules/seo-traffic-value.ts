import { buildTrafficValue } from "@/lib/intel/seo-portfolio";
import { signalSnapshotRepo } from "@/server/db/repos/signal-snapshot.repo";
import type { NewSignal } from "@/server/db/schema";
import type { ModuleRunner } from "../dispatcher";
import { asOutput } from "./module-helpers";
import { readRankedKeywords } from "./seo-position-distribution";

/**
 * seo_traffic_value — estimated dollar value of the site's organic traffic
 * (issue #386 P1): estimated clicks (organic CTR-by-position × search volume) ×
 * CPC, i.e. what that traffic would cost to buy via paid search. Ties SEO to the
 * revenue framing. Derived from `seo_keyword_changes`; pure composite, zero cost.
 */
export const runSeoTrafficValue: ModuleRunner = async ({
  entity,
  userId,
  run,
}) => {
  const snap = await signalSnapshotRepo.findLatest(
    entity.id,
    "seo_keyword_changes",
  );
  const keywords = readRankedKeywords(snap?.payload);

  if (snap?.hasDataIssues || keywords.length === 0) {
    return {
      output: {
        domain: entity.domain,
        dataIssues: [
          "No ranked-keyword data yet — run seo_keyword_changes first",
        ],
      },
      signals: [],
      costUnits: 0,
    };
  }

  const value = buildTrafficValue(keywords);
  const signals: NewSignal[] = [
    {
      userId,
      subjectEntityId: entity.id,
      capabilityKey: "seo_traffic_value",
      severity: "p3",
      title: `Organic traffic value: ~$${value.monthlyValueUsd.toLocaleString()}/mo`,
      summary: `${entity.domain}'s organic rankings drive ~${value.estimatedClicks.toLocaleString()} clicks/mo, worth ~$${value.monthlyValueUsd.toLocaleString()}/mo at paid-search rates (across ${value.keywordsValued} keywords with a CPC).`,
      evidence: {
        sourceUrl: `https://${entity.domain}`,
        runId: run.id,
        details: { ...value },
      },
      confidence: "0.6",
      dedupKey: `seo_traffic_value:${entity.id}`,
    },
  ];

  return {
    output: asOutput({ domain: entity.domain, ...value }),
    signals,
    costUnits: 0,
  };
};
