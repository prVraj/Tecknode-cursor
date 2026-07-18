import type {
  AiMentionsResponse,
  MentionSentiment,
} from "@/lib/intel/ai-mentions";
import type { StoredDataIssue } from "../connector-output";
import type { ModuleRunner } from "../dispatcher";
import { asOutput, getBrand, readDependencySnapshot } from "./module-helpers";

type SentimentBreakdown = Record<MentionSentiment, number>;

export type GeoSentimentOutput = {
  source: "derived/geo_mentions";
  brand: string;
  totalResponses: number;
  scoredResponses: number;
  breakdown: SentimentBreakdown;
  /** -100..100, the figure rivals publish. */
  netSentimentScore: number | null;
  /** 0..100 rescaling of `netSentimentScore`; the primaryScoreField. */
  sentimentScore: number | null;
  dataIssues: StoredDataIssue[];
};

const SENTIMENT_VALUES: readonly MentionSentiment[] = [
  "positive",
  "neutral",
  "negative",
  "not_found",
];

/**
 * `not_found` responses are excluded from the score, so at one scored response
 * a single sentiment flip swings `sentimentScore` by 50 points — five times the
 * score-delta alert threshold. Withhold a score below this.
 */
const MIN_SCORED_SAMPLES = 2;

function emptyBreakdown(): SentimentBreakdown {
  return { positive: 0, neutral: 0, negative: 0, not_found: 0 };
}

function buildOutput(
  fields: Partial<GeoSentimentOutput> & {
    brand: string;
    dataIssues: StoredDataIssue[];
  },
): GeoSentimentOutput {
  return {
    source: "derived/geo_mentions",
    totalResponses: 0,
    scoredResponses: 0,
    breakdown: emptyBreakdown(),
    netSentimentScore: null,
    sentimentScore: null,
    ...fields,
  };
}

export const runGeoSentiment: ModuleRunner = async ({ entity }) => {
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
  const breakdown = emptyBreakdown();

  for (const result of mentions.results) {
    // `sentiment` is typed MentionSentiment, but the producer parses its LLM
    // response with `JSON.parse(...) as LlmMentionMap` and assigns this field
    // with no `?? "not_found"` fallback — it can be undefined at runtime.
    const raw = result.yourBrand.sentiment;
    const sentiment = SENTIMENT_VALUES.includes(raw) ? raw : "not_found";
    breakdown[sentiment] += 1;
  }

  const scoredResponses =
    breakdown.positive + breakdown.neutral + breakdown.negative;
  const netSentimentScore =
    scoredResponses >= MIN_SCORED_SAMPLES
      ? ((breakdown.positive - breakdown.negative) / scoredResponses) * 100
      : null;

  return {
    output: asOutput(
      buildOutput({
        brand: mentions.brand,
        totalResponses: mentions.results.length,
        scoredResponses,
        breakdown,
        netSentimentScore,
        sentimentScore:
          netSentimentScore === null ? null : (netSentimentScore + 100) / 2,
        // Copy the producer's issues verbatim; without this a degraded
        // geo_mentions sample yields a confident score here. See
        // `readDependencySnapshot`.
        dataIssues: producerDataIssues,
      }),
    ),
    signals: [],
    costUnits: 0,
  };
};
