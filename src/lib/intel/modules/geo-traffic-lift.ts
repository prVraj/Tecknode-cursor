import {
  type AiTrafficEstimateResponse,
  buildAiTrafficEstimateResponse,
} from "@/lib/intel/ai-traffic-estimate";
import { buildAiTrafficLift } from "@/lib/intel/ai-traffic-lift";
import type { CompetitorVisibilityResponse } from "@/lib/intel/competitor-visibility";
import type { CapabilityKey, NewSignal } from "@/server/db/schema";
import type { ModuleRunner } from "../dispatcher";
import {
  asOutput,
  getPrompts,
  readTodaySnapshotPayload,
  requireEnv,
} from "./module-helpers";

const SIGNIFICANT_UPLIFT_PERCENT = 25;

/** Highest-coverage competitor from a same-day competitor-visibility snapshot. */
function topCompetitorFrom(
  snap: CompetitorVisibilityResponse | null,
): { domain: string; citationRate: number } | null {
  if (!snap) return null;
  let best: { domain: string; citationRate: number } | null = null;
  for (const d of snap.domains) {
    if (d.isYourDomain || d.totalPrompts <= 0) continue;
    const rate = d.citedPromptCount / d.totalPrompts;
    if (!best || rate > best.citationRate) {
      best = { domain: d.domain, citationRate: rate };
    }
  }
  return best;
}

/** Map a same-day content-gap score (0–100, higher = bigger gap) to the share
 *  of uncited prompts we treat as realistically winnable. */
function addressableFractionFrom(gapSnap: { gapScore?: unknown } | null) {
  const gapScore =
    gapSnap && typeof gapSnap.gapScore === "number" ? gapSnap.gapScore : null;
  if (gapScore === null) return undefined; // builder default (0.6)
  return Math.min(0.8, Math.max(0.3, 0.3 + (gapScore / 100) * 0.5));
}

export const runGeoTrafficLift: ModuleRunner = async ({
  userId: _userId,
  entity,
  run,
}) => {
  const today = new Date().toISOString().slice(0, 10);

  // Reuse today's geo_traffic_estimate probe (identical Perplexity call) when it
  // already ran in this drain; only recompute if it hasn't. costUnits reflects
  // whether we re-probed.
  let costUnits = 0;
  const derivedFrom: CapabilityKey[] = [];
  let estimate = await readTodaySnapshotPayload<AiTrafficEstimateResponse>(
    entity.id,
    "geo_traffic_estimate",
    today,
  );
  if (estimate) {
    derivedFrom.push("geo_traffic_estimate");
  }
  if (!estimate) {
    const apiKey = requireEnv("OPENROUTER_API_KEY", "geo_traffic_lift");
    estimate = await buildAiTrafficEstimateResponse({
      domain: entity.domain,
      prompts: getPrompts(entity),
      apiKey,
    });
    costUnits = 2;
  }

  // Optional context — reuse only, never re-probe.
  const competitorVisibility =
    await readTodaySnapshotPayload<CompetitorVisibilityResponse>(
      entity.id,
      "geo_competitor_visibility",
      today,
    );
  if (competitorVisibility) {
    derivedFrom.push("geo_competitor_visibility");
  }
  const contentGap = await readTodaySnapshotPayload<{ gapScore?: unknown }>(
    entity.id,
    "geo_content_gap",
    today,
  );
  if (contentGap) {
    derivedFrom.push("geo_content_gap");
  }

  const output = buildAiTrafficLift({
    estimate,
    topCompetitor: topCompetitorFrom(competitorVisibility),
    addressableFraction: addressableFractionFrom(contentGap),
  });

  const signals: NewSignal[] = [];
  const dedupKey = `geo_traffic_lift:${entity.id}`;
  const lift = output.totalProjectedMonthlyClickLift;
  const pct = output.totalUpliftPercent;
  const significant =
    lift > 0 && (pct === null || pct >= SIGNIFICANT_UPLIFT_PERCENT);

  if (significant) {
    signals.push({
      userId: _userId,
      subjectEntityId: entity.id,
      capabilityKey: "geo_traffic_lift",
      severity: "p2",
      title: `~${lift.toLocaleString()} more AI clicks/mo available${pct !== null ? ` (+${pct}%)` : ""}`,
      summary: output.scenarios
        .filter((s) => s.projectedMonthlyClickLift > 0)
        .map(
          (s) =>
            `${s.label}: +${s.projectedMonthlyClickLift.toLocaleString()}/mo`,
        )
        .join(" · "),
      evidence: {
        runId: run.id,
        details: {
          modeledCurrentMonthlyClicks: output.modeledCurrentMonthlyClicks,
          totalProjectedMonthlyClickLift: lift,
          totalUpliftPercent: pct,
          scenarios: output.scenarios,
          recommendations: output.recommendations,
        },
      },
      confidence: "0.6",
      dedupKey: `${dedupKey}:opportunity:${today}`,
    });
  } else {
    signals.push({
      userId: _userId,
      subjectEntityId: entity.id,
      capabilityKey: "geo_traffic_lift",
      severity: "p3",
      title: `AI traffic lift baseline: ~${lift.toLocaleString()} clicks/mo opportunity`,
      summary: `Modeled current: ${output.modeledCurrentMonthlyClicks.toLocaleString()} clicks/mo. No high-uplift opportunity above ${SIGNIFICANT_UPLIFT_PERCENT}% right now.`,
      evidence: {
        runId: run.id,
        details: { baseline: true, scenarios: output.scenarios },
      },
      confidence: "0.6",
      dedupKey,
    });
  }

  return {
    output: asOutput(output),
    signals,
    costUnits,
    snapshotProvenance: derivedFrom.length > 0 ? { derivedFrom } : undefined,
  };
};
