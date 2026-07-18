import type { AiMentionsResponse } from "@/lib/intel/ai-mentions";
import type { StoredDataIssue } from "../connector-output";
import type { ModuleRunner } from "../dispatcher";
import { asOutput, getBrand, readDependencySnapshot } from "./module-helpers";

export type GeoAnswerPositionOutput = {
  source: "derived/geo_mentions";
  brand: string;
  totalResponses: number;
  rankedResponses: number;
  /** Mean ordinal rank within AI answers, 1 = named first. The primaryScoreField. */
  avgListRank: number | null;
  bestRank: number | null;
  worstRank: number | null;
  dataIssues: StoredDataIssue[];
};

/**
 * A lone ranked answer swinging 1 → 3 is a 200% move on a 1–10 scale, clearing
 * the global 15% score-delta threshold on pure sampling noise. Withhold a score
 * below this.
 */
const MIN_RANKED_SAMPLES = 2;

function buildOutput(
  fields: Partial<GeoAnswerPositionOutput> & {
    brand: string;
    dataIssues: StoredDataIssue[];
  },
): GeoAnswerPositionOutput {
  return {
    source: "derived/geo_mentions",
    totalResponses: 0,
    rankedResponses: 0,
    avgListRank: null,
    bestRank: null,
    worstRank: null,
    ...fields,
  };
}

export const runGeoAnswerPosition: ModuleRunner = async ({ entity }) => {
  const today = new Date().toISOString().slice(0, 10);
  const dep = await readDependencySnapshot<AiMentionsResponse>(
    entity.id,
    "geo_mentions",
    today,
  );

  if (!dep.ok) {
    return {
      output: asOutput(
        buildOutput({ brand: getBrand(entity), dataIssues: dep.dataIssues }),
      ),
      signals: [],
      costUnits: 0,
    };
  }

  const { payload: mentions, producerDataIssues } = dep;

  // `listRank` is the ordinal position within the answer — the metric rivals
  // publish as "Average Position". Not `summary.avgPosition`, which is the mode
  // of an early/middle/late text-position label and unrelated to rank.
  const ranks = mentions.results
    .map((result) => result.yourBrand.listRank)
    .filter((rank): rank is number => typeof rank === "number");

  const avgListRank =
    ranks.length >= MIN_RANKED_SAMPLES
      ? ranks.reduce((sum, rank) => sum + rank, 0) / ranks.length
      : null;

  return {
    output: asOutput(
      buildOutput({
        brand: mentions.brand,
        totalResponses: mentions.results.length,
        rankedResponses: ranks.length,
        avgListRank,
        bestRank: ranks.length > 0 ? Math.min(...ranks) : null,
        worstRank: ranks.length > 0 ? Math.max(...ranks) : null,
        // Copy the producer's issues verbatim. See `readDependencySnapshot`.
        dataIssues: producerDataIssues,
      }),
    ),
    signals: [],
    costUnits: 0,
  };
};
