import { estimateReach } from "./reach";
import type {
  ClassifiedMention,
  ModuleCoverage,
  PlatformResult,
  SearchAggregates,
  Sentiment,
  SignalBuckets,
  SignalType,
} from "./types";
import { SENTIMENTS, SIGNAL_TYPES } from "./types";

/** Static coverage report for the Brand & Keyword Monitoring module. */
export const BRAND_KEYWORD_COVERAGE: ModuleCoverage = {
  // #12: follower count from X + GitHub + Bluesky + YouTube.
  // #22: real reach on X/YouTube/SO; documented estimate (reachBySource) elsewhere.
  // #14: HN front-page rank. #17: Wikipedia search. #24: one-shot topic clustering.
  covered: [
    "#1",
    "#2",
    "#3",
    "#4",
    "#5",
    "#6",
    "#7",
    "#12",
    "#14",
    "#17",
    "#18",
    "#19",
    "#22",
    "#24",
    "#27",
  ],
  // #25: news via GDELT (free); journalist-by-name half needs a paid DB.
  // #27: boolean AND/OR/NOT — full on X, best-effort (any-terms) elsewhere.
  partial: ["#25", "#26"],
  deferred: ["#8", "#9", "#10", "#11", "#20", "#23", "#31"],
  unavailable: ["#13", "#15", "#16", "#21", "#28", "#29", "#30"],
};

function zeroSentiment(): Record<Sentiment, number> {
  return { positive: 0, neutral: 0, negative: 0 };
}

function zeroSignal(): Record<SignalType, number> {
  return Object.fromEntries(SIGNAL_TYPES.map((s) => [s, 0])) as Record<
    SignalType,
    number
  >;
}

function okMentions(results: PlatformResult[]): ClassifiedMention[] {
  return results.flatMap((r) => (r.status === "ok" ? r.mentions : []));
}

export function computeAggregates(results: PlatformResult[]): SearchAggregates {
  const mentions = okMentions(results);
  const byPlatform: Record<string, number> = {};
  const bySentiment = zeroSentiment();
  const bySignalType = zeroSignal();
  const sentimentByPlatform: Record<string, Record<Sentiment, number>> = {};
  let influencerMentions = 0;
  let estimatedReach = 0;
  const reachBySource: Record<string, number> = {};
  let p0Count = 0;

  for (const m of mentions) {
    byPlatform[m.platform] = (byPlatform[m.platform] ?? 0) + 1;

    const reach = estimateReach(m);
    estimatedReach += reach.value;
    reachBySource[reach.source] =
      (reachBySource[reach.source] ?? 0) + reach.value;

    const c = m.classification;
    if (!c) continue;
    bySentiment[c.sentiment] += 1;
    bySignalType[c.signalType] += 1;
    if (c.isInfluencer) influencerMentions += 1;
    if (c.priority === "P0") p0Count += 1;

    sentimentByPlatform[m.platform] ??= zeroSentiment();
    sentimentByPlatform[m.platform][c.sentiment] += 1;
  }

  return {
    totalMentions: mentions.length,
    byPlatform,
    bySentiment,
    bySignalType,
    sentimentByPlatform,
    influencerMentions,
    estimatedReach,
    reachBySource,
    p0Count,
  };
}

const bySignal = (mentions: ClassifiedMention[], type: SignalType) =>
  mentions.filter((m) => m.classification?.signalType === type);

export function buildSignalBuckets(
  results: PlatformResult[],
  aggregates: SearchAggregates,
): SignalBuckets {
  const mentions = okMentions(results);

  return {
    brandMentions: {
      total: aggregates.totalMentions,
      byPlatform: aggregates.byPlatform,
      bySentiment: aggregates.bySentiment,
    },
    churn: bySignal(mentions, "churn"),
    comparison: bySignal(mentions, "comparison"),
    positiveChurn: bySignal(mentions, "positive_churn"),
    buyingIntent: bySignal(mentions, "buying_intent"),
    painPoints: bySignal(mentions, "pain_point"),
    featureRequests: bySignal(mentions, "feature_request"),
    influencerMentions: mentions.filter(
      (m) => m.classification?.isInfluencer === true,
    ),
    sentimentByPlatform: aggregates.sentimentByPlatform,
    volumeByPlatform: aggregates.byPlatform,
    estimatedReach: aggregates.estimatedReach,
  };
}

// Re-exported so callers don't need to import the enums separately.
export { SENTIMENTS, SIGNAL_TYPES };
