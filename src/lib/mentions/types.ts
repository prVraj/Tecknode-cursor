import type { BooleanQuery } from "./boolean-query";

export const PLATFORMS = [
  "x",
  "reddit",
  "hn",
  "bluesky",
  "youtube",
  "producthunt",
  "stackoverflow",
  "wikipedia",
] as const;

export type Platform = (typeof PLATFORMS)[number];

export const PLATFORM_LABELS: Record<Platform, string> = {
  x: "X (Twitter)",
  reddit: "Reddit",
  hn: "Hacker News",
  bluesky: "Bluesky",
  youtube: "YouTube",
  producthunt: "Product Hunt",
  stackoverflow: "Stack Overflow",
  wikipedia: "Wikipedia",
};

export type SearchInput = {
  brandName: string;
  handle: string | null;
  domain: string;
  /** Optional extra keyword terms (item #5 — keyword mention tracking). */
  keywords: string[];
  /** Optional boolean filter (#27) — currently applied on X (full operators). */
  booleanQuery?: BooleanQuery;
  limit: number;
};

export type NormalizedMention = {
  platform: Platform;
  id: string;
  text: string;
  url: string;
  author: {
    name: string | null;
    handle: string | null;
    followerCount?: number;
  };
  createdAt: string;
  engagement: {
    score?: number;
    comments?: number;
    shares?: number;
    impressions?: number;
  };
  context?: string;
};

export const SENTIMENTS = ["positive", "neutral", "negative"] as const;
export type Sentiment = (typeof SENTIMENTS)[number];

/** Maps directly to the data-point matrix triggers. */
export const SIGNAL_TYPES = [
  "brand_mention", // plain mention, no strong intent
  "pain_point", // complaint / frustration about the brand
  "churn", // "switched away from {brand}" / cancelling
  "comparison", // "alternative to / vs {brand}"
  "positive_churn", // "switched TO {brand}" from a competitor
  "buying_intent", // "looking for", "need a tool", "recommend", "best X for"
  "feature_request", // "wish {brand} had", "{brand} should"
] as const;
export type SignalType = (typeof SIGNAL_TYPES)[number];

export type Priority = "P0" | "P1" | "P2";

export type Classification = {
  sentiment: Sentiment;
  signalType: SignalType;
  priority: Priority;
  /** True when author follower count is known and >= 10k (influencer data point). */
  isInfluencer: boolean;
  /** False when the LLM judged this a coincidental keyword match, not the brand. */
  isRelevant: boolean;
};

export type ClassifiedMention = NormalizedMention & {
  classification: Classification | null; // null when classification disabled/failed
};

export type PlatformResult =
  | { platform: Platform; status: "ok"; mentions: ClassifiedMention[] }
  | { platform: Platform; status: "error"; error: string }
  | { platform: Platform; status: "skipped"; reason: string };

/** Within-search aggregates — the derivable data points (no persistence needed). */
export type SearchAggregates = {
  totalMentions: number;
  byPlatform: Record<string, number>;
  bySentiment: Record<Sentiment, number>;
  bySignalType: Record<SignalType, number>;
  sentimentByPlatform: Record<string, Record<Sentiment, number>>;
  influencerMentions: number;
  /** #22 — total reach: real where the platform reports it, estimated otherwise. */
  estimatedReach: number;
  /** Transparency: how much of estimatedReach is measured vs estimated. */
  reachBySource: Record<string, number>;
  p0Count: number;
};

/** Signal buckets — map 1:1 to Brand & Keyword Monitoring module rows. */
export type SignalBuckets = {
  brandMentions: {
    total: number;
    byPlatform: Record<string, number>;
    bySentiment: Record<Sentiment, number>;
  };
  churn: ClassifiedMention[]; // #2 "switched from you → competitor"
  comparison: ClassifiedMention[]; // #3 "alternative to / vs you"
  positiveChurn: ClassifiedMention[]; // #4 "switched → you"
  buyingIntent: ClassifiedMention[]; // #6 buying-intent threads
  painPoints: ClassifiedMention[]; // feature/pain signal
  featureRequests: ClassifiedMention[]; // feature signal
  influencerMentions: ClassifiedMention[]; // #12 (>10k followers)
  sentimentByPlatform: Record<string, Record<Sentiment, number>>; // #7
  volumeByPlatform: Record<string, number>; // #10 snapshot (not weekly shift)
  estimatedReach: number; // #22 (impressions where available)
};

export type ModuleCoverage = {
  covered: string[];
  partial: string[];
  deferred: string[]; // needs persistence / time-series
  unavailable: string[]; // platform/source not integrated
};

export type SearchResponse = {
  query: SearchInput;
  module: "brand_keyword_monitoring";
  classified: boolean;
  results: PlatformResult[];
  aggregates: SearchAggregates;
  signals: SignalBuckets;
  coverage: ModuleCoverage;
  durationMs: number;
};

export type PlatformClient = {
  platform: Platform;
  /** Returns null if creds are missing (platform will be marked "skipped") */
  search(input: SearchInput): Promise<NormalizedMention[] | null>;
};
