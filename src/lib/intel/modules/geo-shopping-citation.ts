import { buildShoppingCitationReport } from "@/lib/intel/shopping-citations";
import { signalSnapshotRepo } from "@/server/db/repos/signal-snapshot.repo";
import type { NewSignal } from "@/server/db/schema";
import type { ModuleRunner, ModuleRunResult } from "../dispatcher";
import {
  getBrand,
  getCompetitorDomains,
  getKeywords,
  requireEnv,
} from "./module-helpers";

/**
 * geo_shopping_citation — AEO/GEO shopping citation tracker. Measures whether
 * the brand is cited/recommended when users ask AI engines BUYING-INTENT
 * questions ("best X", "top X", "X alternatives", "X vs Y"), and who wins
 * those answers instead. This is the commercial-intent slice of GEO: the
 * prompts where a citation maps most directly to a purchase decision.
 *
 * Reuses the existing keyword-citation probe (Perplexity Sonar via OpenRouter)
 * — the new parts are the buying-intent prompt builder and the alerting on
 * shopping share-of-voice (no geo_* module emits alerts today).
 *
 * NOTE: this approximates AI shopping visibility via LLM answers to
 * buying-intent prompts. Dedicated shopping surfaces (ChatGPT/Perplexity
 * product cards, Google AI Overview shopping carousels, Amazon Rufus, merchant
 * feeds) are not API-accessible, so they are intentionally out of scope.
 */

// Buying-intent templates applied to each base keyword. `{kw}` = the keyword.
const INTENT_TEMPLATES = [
  (kw: string) => `best ${kw}`,
  (kw: string) => `top ${kw} for businesses`,
  (kw: string) => `${kw} alternatives`,
  (kw: string) => `most affordable ${kw}`,
] as const;

// Cap total prompts to bound OpenRouter cost (each prompt × 2 Perplexity models).
const MAX_PROMPTS = 12;
const MAX_BASE_KEYWORDS = 3;
// A drop of this many points in shopping citation rate vs prior → p1.
const RATE_DROP_ALERT = 20;
// Not cited on at least this share of buying-intent prompts → p2.
const ABSENCE_THRESHOLD = 0.6;

export function buildBuyingIntentPrompts(
  keywords: string[],
  brand: string,
): string[] {
  const prompts: string[] = [];
  const push = (p: string) => {
    if (p.trim().length > 0 && !prompts.includes(p)) prompts.push(p);
  };

  for (const kw of keywords.slice(0, MAX_BASE_KEYWORDS)) {
    for (const tmpl of INTENT_TEMPLATES) push(tmpl(kw));
  }
  // Brand-anchored buying-intent prompts (always useful even without keywords).
  push(`is ${brand} worth it`);
  push(`${brand} vs alternatives`);

  return prompts.slice(0, MAX_PROMPTS);
}

interface AlertInput {
  userId: string;
  entityId: string;
  runId: string;
  rate: number;
  prevRate: number | null;
  hasPrev: boolean;
  promptsWhereYouLead: number;
  promptsWhereCompetitorLeads: number;
  promptsNotCited: number;
  totalPrompts: number;
  leader: string | null;
}

/** Prior shopping citation rate from the last snapshot (score, then payload). */
function priorRate(
  prev: {
    primaryScore?: number | string | null;
    payload?: Record<string, unknown> | null;
  } | null,
): number | null {
  const score = prev?.primaryScore;
  if (typeof score === "number") return score;
  if (typeof score === "string") {
    const n = Number.parseFloat(score);
    if (!Number.isNaN(n)) return n;
  }
  const fromPayload = prev?.payload?.shoppingCitationRate;
  return typeof fromPayload === "number" ? fromPayload : null;
}

/** Pick the single highest-severity shopping-citation signal (if any). */
function buildShoppingSignal(input: AlertInput): NewSignal | null {
  const base = {
    userId: input.userId,
    subjectEntityId: input.entityId,
    capabilityKey: "geo_shopping_citation" as const,
    dedupKey: `geo_shopping_citation:${input.entityId}`,
  };
  const evidenceBase = {
    runId: input.runId,
    sourceUrl: "https://www.perplexity.ai",
  };

  if (!input.hasPrev) {
    return {
      ...base,
      severity: "p3",
      title: `Shopping citation baseline: ${input.rate}% of buying-intent answers`,
      summary: `Cited in ${input.promptsWhereYouLead}/${input.totalPrompts} buying-intent answers at rank 1. Tracking commercial-intent AI visibility.`,
      evidence: {
        ...evidenceBase,
        details: { baseline: true, shoppingCitationRate: input.rate },
      },
      confidence: "0.7",
    };
  }

  const drop = input.prevRate != null ? input.prevRate - input.rate : 0;
  if (drop >= RATE_DROP_ALERT) {
    return {
      ...base,
      severity: "p1",
      title: `Shopping citation rate dropped ${Math.round(drop)} pts to ${input.rate}%`,
      summary: `AI engines now cite you in fewer buying-intent answers (${input.prevRate}% → ${input.rate}%). Lost commercial-intent visibility goes straight to competitors.`,
      evidence: {
        ...evidenceBase,
        details: {
          shoppingCitationRate: input.rate,
          previousRate: input.prevRate,
          drop,
        },
      },
      confidence: "0.8",
    };
  }

  if (
    input.leader &&
    input.promptsWhereCompetitorLeads > input.promptsWhereYouLead
  ) {
    return {
      ...base,
      severity: "p2",
      title: `${input.leader} leads AI shopping answers (${input.promptsWhereCompetitorLeads}/${input.totalPrompts})`,
      summary: `A competitor is cited first on more buying-intent prompts than you. Strengthen comparison/review content to reclaim recommendation share.`,
      evidence: {
        ...evidenceBase,
        details: {
          leader: input.leader,
          promptsWhereCompetitorLeads: input.promptsWhereCompetitorLeads,
          promptsWhereYouLead: input.promptsWhereYouLead,
        },
      },
      confidence: "0.75",
    };
  }

  if (
    input.totalPrompts > 0 &&
    input.promptsNotCited / input.totalPrompts >= ABSENCE_THRESHOLD
  ) {
    return {
      ...base,
      severity: "p2",
      title: `Absent from ${input.promptsNotCited}/${input.totalPrompts} AI shopping answers`,
      summary: `Not cited on most buying-intent prompts. Add review/comparison/listicle content that LLMs cite for purchase decisions.`,
      evidence: {
        ...evidenceBase,
        details: {
          promptsNotCited: input.promptsNotCited,
          shoppingCitationRate: input.rate,
        },
      },
      confidence: "0.7",
    };
  }

  return null;
}

export const runGeoShoppingCitation: ModuleRunner = async ({
  userId,
  entity,
  run,
}) => {
  const apiKey = requireEnv("OPENROUTER_API_KEY", "geo_shopping_citation");
  const competitors = await getCompetitorDomains({ userId, entity });
  const prompts = buildBuyingIntentPrompts(
    getKeywords(entity),
    getBrand(entity),
  );

  const report = await buildShoppingCitationReport({
    domain: entity.domain,
    brand: getBrand(entity),
    competitors,
    prompts,
    apiKey,
  });

  const rate = report.shoppingCitationRate;
  const leader = report.competitorLeaderboard[0]?.domain ?? null;

  const prev = await signalSnapshotRepo.findLatest(
    entity.id,
    "geo_shopping_citation",
  );
  const prevRate = priorRate(prev);

  const signal = buildShoppingSignal({
    userId,
    entityId: entity.id,
    runId: run.id,
    rate,
    prevRate,
    hasPrev: prev != null,
    promptsWhereYouLead: report.promptsWhereYouLead,
    promptsWhereCompetitorLeads: report.promptsWhereCompetitorLeads,
    promptsNotCited: report.promptsNotCited,
    totalPrompts: report.totalPrompts,
    leader,
  });

  const output: ModuleRunResult["output"] = {
    source: "openrouter/perplexity",
    yourDomain: report.yourDomain,
    competitors: report.competitors,
    shoppingCitationRate: rate,
    buyingIntentPrompts: prompts,
    promptsWhereYouLead: report.promptsWhereYouLead,
    promptsWhereCompetitorLeads: report.promptsWhereCompetitorLeads,
    promptsNotCited: report.promptsNotCited,
    competitorLeaderboard: report.competitorLeaderboard,
    results: report.results,
    dataIssues: report.dataIssues,
  };

  return { output, signals: signal ? [signal] : [], costUnits: 2 };
};
