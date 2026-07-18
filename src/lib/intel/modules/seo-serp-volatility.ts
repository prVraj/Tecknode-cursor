import { buildSerpVolatility } from "@/lib/intel/seo-portfolio";
import { signalSnapshotRepo } from "@/server/db/repos/signal-snapshot.repo";
import type { NewSignal } from "@/server/db/schema";
import type { ModuleRunner } from "../dispatcher";
import { asOutput } from "./module-helpers";
import { readRankedKeywords } from "./seo-position-distribution";

/**
 * seo_serp_volatility — "you vs Google" flux (= Semrush Sensor), issue #386 P1.
 * Compares the two most recent `seo_keyword_changes` snapshots to measure how
 * much the tracked keyword positions moved. High shared volatility points at a
 * Google algorithm update rather than a site-specific issue, letting a
 * rank-drop alert say which it is. Pure DB composite, zero cost.
 */
export const runSeoSerpVolatility: ModuleRunner = async ({
  entity,
  userId,
  run,
}) => {
  // Two most recent snapshots: today's and the prior comparable day.
  const history = await signalSnapshotRepo.listHistory(
    entity.id,
    "seo_keyword_changes",
    2,
  );
  const clean = history.filter((s) => !s.hasDataIssues);

  if (clean.length < 2) {
    return {
      output: {
        domain: entity.domain,
        dataIssues: [
          "Need two clean seo_keyword_changes snapshots to measure volatility",
        ],
      },
      signals: [],
      costUnits: 0,
    };
  }

  // listHistory is newest-first.
  const [today, previous] = clean;
  const vol = buildSerpVolatility(
    readRankedKeywords(today.payload),
    readRankedKeywords(previous.payload),
  );

  if (vol.comparedKeywords === 0) {
    return {
      output: {
        domain: entity.domain,
        ...vol,
        dataIssues: ["No overlapping keywords between snapshots"],
      },
      signals: [],
      costUnits: 0,
    };
  }

  // Only elevated volatility is worth surfacing; calm days are just baseline.
  const notable = vol.band === "high" || vol.band === "very_high";
  const signals: NewSignal[] = [
    {
      userId,
      subjectEntityId: entity.id,
      capabilityKey: "seo_serp_volatility",
      severity: notable ? "p2" : "p3",
      title: notable
        ? `High SERP volatility (${vol.volatility}/100) — likely a Google update`
        : `SERP volatility: ${vol.volatility}/100 (${vol.band})`,
      summary: `Tracked keywords moved an average of ${vol.avgPositionChange} positions since the last check (${vol.comparedKeywords} keywords compared).${notable ? " Broad movement like this usually means an algorithm update, not a site-specific problem." : ""}`,
      evidence: {
        sourceUrl: `https://${entity.domain}`,
        runId: run.id,
        details: { ...vol },
      },
      confidence: "0.6",
      dedupKey: `seo_serp_volatility:${entity.id}`,
    },
  ];

  return {
    output: asOutput({ domain: entity.domain, ...vol }),
    signals,
    costUnits: 0,
  };
};
