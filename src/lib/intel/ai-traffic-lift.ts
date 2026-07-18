/**
 * AI search traffic LIFT projection — the forward-looking counterpart to
 * `ai-traffic-estimate`. Given the measured current citation state (which
 * prompts your domain is cited for, and at what position), it projects how
 * many additional monthly clicks realistic GEO optimizations would unlock.
 *
 * It is pure, deterministic math over an `AiTrafficEstimateResponse` — no
 * network calls of its own. Three scenarios:
 *   • position  — pull citations that rank below top-3 up into top-3
 *   • coverage  — win citations for prompts where you're currently absent
 *   • parity    — match the top competitor's citation coverage (stretch ceiling)
 *
 * The headline `totalProjectedMonthlyClickLift` is position + coverage (the two
 * realistic, addressable, disjoint components). Parity is reported separately as
 * an aspirational ceiling. Absolute click numbers inherit the volume
 * assumptions of `ai-traffic-estimate`; the relative uplift % is the robust
 * signal and is surfaced prominently.
 */
import {
  type AiTrafficEstimateResponse,
  ctrForPosition,
  engineMonthlyQueries,
  platformToEngine,
} from "./ai-traffic-estimate";

// Realistic optimization targets (citation positions).
const POSITION_LIFT_TARGET = 3; // pull cited-but-low results into the top 3
const COVERAGE_ENTRY_POSITION = 5; // newly-won citations enter mid-pack
const STRETCH_POSITION = 2; // aspirational top-of-answer presence
const DEFAULT_ADDRESSABLE_FRACTION = 0.6; // share of gap prompts realistically winnable
const MAX_RECO_PROMPTS = 5;

export type LiftScenarioKey = "position" | "coverage" | "parity";

export type LiftScenario = {
  key: LiftScenarioKey;
  label: string;
  projectedMonthlyClickLift: number;
  upliftPercent: number | null;
  promptsAffected: number;
  basis: string;
};

export type LiftRecommendation = {
  scenario: LiftScenarioKey;
  action: string;
  prompts: string[];
  projectedClickLift: number;
};

export type AiTrafficLiftResponse = {
  source: "derived/ai-traffic-estimate";
  yourDomain: string;
  modeledCurrentMonthlyClicks: number;
  totalProjectedMonthlyClickLift: number;
  totalUpliftPercent: number | null;
  scenarios: LiftScenario[];
  recommendations: LiftRecommendation[];
  assumptions: string[];
  dataIssues: string[];
};

type Probe = { engine: string; prompt: string; position: number | null };

function probesFromEstimate(estimate: AiTrafficEstimateResponse): Probe[] {
  return estimate.rawResults.map((r) => ({
    engine: platformToEngine(r.platform),
    prompt: r.prompt,
    position: r.yourDomainPosition,
  }));
}

/**
 * Modeled monthly clicks for a set of probes under a given position mapping.
 * Each engine's monthly query volume is split evenly across its probes (each
 * probe is a representative sample of that engine's query mix); a probe earns
 * `share × CTR(position)` clicks, or 0 when uncited.
 */
function clicksFor(
  probes: Probe[],
  positionOf: (p: Probe) => number | null,
): number {
  const byEngine = new Map<string, Probe[]>();
  for (const p of probes) {
    const list = byEngine.get(p.engine) ?? [];
    list.push(p);
    byEngine.set(p.engine, list);
  }

  let total = 0;
  for (const [engine, list] of byEngine) {
    const q = engineMonthlyQueries(engine);
    if (q <= 0 || list.length === 0) continue;
    const share = q / list.length;
    for (const p of list) {
      const pos = positionOf(p);
      total += pos === null ? 0 : share * ctrForPosition(pos);
    }
  }
  return Math.round(total);
}

function upliftPercent(current: number, lift: number): number | null {
  if (current <= 0) return null; // net-new traffic — percentage is undefined
  return Math.round((lift / current) * 1000) / 10;
}

function uniquePrompts(probes: Probe[], limit: number): string[] {
  const seen = new Set<string>();
  for (const p of probes) seen.add(p.prompt);
  return Array.from(seen).slice(0, limit);
}

export function buildAiTrafficLift({
  estimate,
  topCompetitor,
  addressableFraction = DEFAULT_ADDRESSABLE_FRACTION,
}: {
  estimate: AiTrafficEstimateResponse;
  topCompetitor?: { domain: string; citationRate: number } | null;
  addressableFraction?: number;
}): AiTrafficLiftResponse {
  const probes = probesFromEstimate(estimate);
  const dataIssues = [...estimate.dataIssues];

  const current = clicksFor(probes, (p) => p.position);

  // ── Scenario A: position lift (cited but below top-3 → top-3) ────────────
  const positionProbes = probes.filter(
    (p) => p.position !== null && p.position > POSITION_LIFT_TARGET,
  );
  const liftPosition = Math.max(
    0,
    clicksFor(probes, (p) =>
      p.position === null ? null : Math.min(p.position, POSITION_LIFT_TARGET),
    ) - current,
  );

  // ── Scenario B: coverage lift (uncited → entry position), addressable only ─
  const uncitedProbes = probes.filter((p) => p.position === null);
  const fraction = Math.min(1, Math.max(0, addressableFraction));
  const liftCoverageFull = Math.max(
    0,
    clicksFor(probes, (p) =>
      p.position === null ? COVERAGE_ENTRY_POSITION : p.position,
    ) - current,
  );
  const liftCoverage = Math.round(liftCoverageFull * fraction);
  const coveragePromptCount = Math.ceil(
    new Set(uncitedProbes.map((p) => p.prompt)).size * fraction,
  );

  // ── Scenario C: competitor-parity ceiling ────────────────────────────────
  const n = probes.length;
  const currentCited = probes.filter((p) => p.position !== null).length;
  const currentRate = n > 0 ? currentCited / n : 0;
  const targetRate = topCompetitor
    ? Math.min(1, Math.max(currentRate, topCompetitor.citationRate))
    : 1;
  const targetCited = Math.round(targetRate * n);

  // Keep currently-cited probes cited; promote uncited ones until the target
  // coverage is reached. All cited probes modeled at the stretch position.
  const parityCited = new Set<Probe>(probes.filter((p) => p.position !== null));
  for (const p of uncitedProbes) {
    if (parityCited.size >= targetCited) break;
    parityCited.add(p);
  }
  const liftParity = Math.max(
    0,
    clicksFor(probes, (p) => (parityCited.has(p) ? STRETCH_POSITION : null)) -
      current,
  );
  const parityPromptCount = Math.max(0, parityCited.size - currentCited);

  const totalLift = liftPosition + liftCoverage;

  const scenarios: LiftScenario[] = [
    {
      key: "position",
      label: "Position lift (move below-top-3 citations into top 3)",
      projectedMonthlyClickLift: liftPosition,
      upliftPercent: upliftPercent(current, liftPosition),
      promptsAffected: new Set(positionProbes.map((p) => p.prompt)).size,
      basis: `Citations currently ranked below position ${POSITION_LIFT_TARGET} promoted to position ${POSITION_LIFT_TARGET}.`,
    },
    {
      key: "coverage",
      label: "Coverage lift (win citations where currently absent)",
      projectedMonthlyClickLift: liftCoverage,
      upliftPercent: upliftPercent(current, liftCoverage),
      promptsAffected: coveragePromptCount,
      basis: `${Math.round(fraction * 100)}% of uncited prompts modeled as newly cited at position ${COVERAGE_ENTRY_POSITION}.`,
    },
    {
      key: "parity",
      label: topCompetitor
        ? `Competitor parity (match ${topCompetitor.domain} coverage)`
        : "Full-coverage ceiling",
      projectedMonthlyClickLift: liftParity,
      upliftPercent: upliftPercent(current, liftParity),
      promptsAffected: parityPromptCount,
      basis: topCompetitor
        ? `Citation coverage raised from ${Math.round(currentRate * 100)}% to ${Math.round(targetRate * 100)}% (${topCompetitor.domain}'s level) at position ${STRETCH_POSITION}.`
        : `Stretch ceiling: every prompt cited at position ${STRETCH_POSITION}. No competitor benchmark available.`,
    },
  ];

  const recommendations: LiftRecommendation[] = [];
  if (liftPosition > 0 && positionProbes.length > 0) {
    recommendations.push({
      scenario: "position",
      action:
        "Strengthen topical authority on pages already cited below the top 3 (depth, freshness, structured answers).",
      prompts: uniquePrompts(positionProbes, MAX_RECO_PROMPTS),
      projectedClickLift: liftPosition,
    });
  }
  if (liftCoverage > 0 && uncitedProbes.length > 0) {
    recommendations.push({
      scenario: "coverage",
      action:
        "Create or optimize GEO-targeted content for prompts where you are not yet cited.",
      prompts: uniquePrompts(uncitedProbes, MAX_RECO_PROMPTS),
      projectedClickLift: liftCoverage,
    });
  }
  if (topCompetitor && liftParity > totalLift) {
    recommendations.push({
      scenario: "parity",
      action: `Close the citation-coverage gap to ${topCompetitor.domain} across your full prompt set.`,
      prompts: uniquePrompts(uncitedProbes, MAX_RECO_PROMPTS),
      projectedClickLift: liftParity,
    });
  }

  const assumptions = [
    "Clicks modeled with the same CTR curve and engine query volumes as geo_traffic_estimate.",
    `Position lift target = top ${POSITION_LIFT_TARGET}; coverage entry = position ${COVERAGE_ENTRY_POSITION}; addressable share of gaps = ${Math.round(fraction * 100)}%.`,
    "Projection is a modeled estimate, not a guarantee; relative uplift % is more reliable than absolute click counts.",
  ];
  if (current <= 0) {
    assumptions.push(
      "Modeled current clicks are ~0, so uplift % is reported as net-new (null).",
    );
  }

  return {
    source: "derived/ai-traffic-estimate",
    yourDomain: estimate.yourDomain,
    modeledCurrentMonthlyClicks: current,
    totalProjectedMonthlyClickLift: totalLift,
    totalUpliftPercent: upliftPercent(current, totalLift),
    scenarios,
    recommendations,
    assumptions,
    dataIssues,
  };
}
