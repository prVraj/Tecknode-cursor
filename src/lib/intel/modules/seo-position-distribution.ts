import type { RankedKeyword } from "@/lib/dataforseo";
import { buildPositionDistribution } from "@/lib/intel/seo-portfolio";
import { signalSnapshotRepo } from "@/server/db/repos/signal-snapshot.repo";
import type { NewSignal } from "@/server/db/schema";
import type { ModuleRunner } from "../dispatcher";
import { asOutput } from "./module-helpers";

/**
 * seo_position_distribution — keyword counts in the 1–3 / 4–10 / … buckets
 * (issue #386 P1). Derived from the `rankedKeywords` payload
 * `seo_keyword_changes` already fetches; pure DB composite, zero cost. Runs for
 * competitors too, so the distribution can be shown head-to-head.
 */
export const runSeoPositionDistribution: ModuleRunner = async ({
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

  const dist = buildPositionDistribution(keywords);
  const signals: NewSignal[] = [
    {
      userId,
      subjectEntityId: entity.id,
      capabilityKey: "seo_position_distribution",
      severity: "p3",
      title: `${dist.topTen} keywords in the top 10 (${dist.totalKeywords} tracked)`,
      summary: `${entity.domain} position spread — top3: ${dist.buckets.top3}, 4–10: ${dist.buckets.top10}, 11–20: ${dist.buckets.top20}, 21–50: ${dist.buckets.top50}, 51–100: ${dist.buckets.top100}.`,
      evidence: {
        sourceUrl: `https://${entity.domain}`,
        runId: run.id,
        details: { ...dist },
      },
      confidence: "0.8",
      dedupKey: `seo_position_distribution:${entity.id}`,
    },
  ];

  return {
    output: asOutput({ domain: entity.domain, ...dist }),
    signals,
    costUnits: 0,
  };
};

export function readRankedKeywords(payload: unknown): RankedKeyword[] {
  const rk = (payload as { rankedKeywords?: unknown } | null)?.rankedKeywords;
  return Array.isArray(rk) ? (rk as RankedKeyword[]) : [];
}
