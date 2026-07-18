import { describe, expect, it } from "vitest";
import { buildSignalBuckets, computeAggregates } from "./aggregate";
import type {
  ClassifiedMention,
  Platform,
  PlatformResult,
  SignalType,
} from "./types";

type MOver = Partial<Omit<ClassifiedMention, "classification">> & {
  classification?: Partial<ClassifiedMention["classification"]>;
};

let counter = 0;
function m(
  platform: Platform,
  signalType: SignalType,
  over: MOver = {},
): ClassifiedMention {
  counter += 1;
  const { classification, ...rest } = over;
  return {
    platform,
    id: `id-${counter}`,
    text: "t",
    url: "https://e/1",
    author: { name: null, handle: null },
    createdAt: new Date().toISOString(),
    engagement: {},
    classification: {
      sentiment: "neutral",
      signalType,
      priority: "P2",
      isInfluencer: false,
      isRelevant: true,
      ...classification,
    },
    ...rest,
  };
}

function ok(platform: Platform, mentions: ClassifiedMention[]): PlatformResult {
  return { platform, status: "ok", mentions };
}

describe("computeAggregates", () => {
  it("counts mentions, platforms, sentiment, signals, p0 and influencers", () => {
    const results: PlatformResult[] = [
      ok("x", [
        m("x", "churn", {
          classification: {
            sentiment: "negative",
            signalType: "churn",
            priority: "P0",
            isInfluencer: true,
          },
          engagement: { impressions: 1000 },
        }),
        m("x", "brand_mention", {
          classification: {
            sentiment: "positive",
            signalType: "brand_mention",
            priority: "P2",
            isInfluencer: false,
          },
        }),
      ]),
      ok("hn", [
        m("hn", "comparison", {
          classification: {
            sentiment: "neutral",
            signalType: "comparison",
            priority: "P0",
            isInfluencer: false,
          },
        }),
      ]),
      { platform: "reddit", status: "skipped", reason: "no creds" },
      { platform: "stackoverflow", status: "error", error: "boom" },
    ];

    const agg = computeAggregates(results);
    expect(agg.totalMentions).toBe(3);
    expect(agg.byPlatform).toEqual({ x: 2, hn: 1 });
    expect(agg.bySentiment).toEqual({ positive: 1, neutral: 1, negative: 1 });
    expect(agg.bySignalType.churn).toBe(1);
    expect(agg.bySignalType.comparison).toBe(1);
    expect(agg.p0Count).toBe(2);
    expect(agg.influencerMentions).toBe(1);
    expect(agg.sentimentByPlatform.x).toEqual({
      positive: 1,
      neutral: 0,
      negative: 1,
    });
    // reach: 1000 actual (x #1) + estimates for the rest
    expect(agg.estimatedReach).toBeGreaterThanOrEqual(1000);
    expect(agg.reachBySource.actual).toBe(1000);
  });

  it("returns zeros for an all-skipped/error result set", () => {
    const agg = computeAggregates([
      { platform: "x", status: "skipped", reason: "no creds" },
    ]);
    expect(agg.totalMentions).toBe(0);
    expect(agg.estimatedReach).toBe(0);
    expect(agg.p0Count).toBe(0);
  });
});

describe("buildSignalBuckets", () => {
  it("routes mentions into the correct signal buckets", () => {
    const results: PlatformResult[] = [
      ok("x", [
        m("x", "churn"),
        m("x", "comparison"),
        m("x", "positive_churn"),
        m("x", "buying_intent"),
        m("x", "brand_mention", {
          classification: {
            sentiment: "neutral",
            signalType: "brand_mention",
            priority: "P2",
            isInfluencer: true,
          },
        }),
      ]),
    ];
    const agg = computeAggregates(results);
    const buckets = buildSignalBuckets(results, agg);

    expect(buckets.churn).toHaveLength(1);
    expect(buckets.comparison).toHaveLength(1);
    expect(buckets.positiveChurn).toHaveLength(1);
    expect(buckets.buyingIntent).toHaveLength(1);
    expect(buckets.influencerMentions).toHaveLength(1);
    expect(buckets.brandMentions.total).toBe(5);
  });
});
