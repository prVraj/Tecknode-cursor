import { describe, expect, it } from "vitest";
import type { Sentiment } from "../types";
import type { StoredMention } from "./json-store";
import { computeTrendsFromMentions } from "./trends";

const DAY = 24 * 60 * 60 * 1000;
let n = 0;

function sm(
  daysAgo: number,
  over: {
    sentiment?: Sentiment;
    priority?: "P0" | "P1" | "P2";
    platform?: string;
  } = {},
): StoredMention {
  n += 1;
  const iso = new Date(Date.now() - daysAgo * DAY).toISOString();
  return {
    platform: (over.platform ?? "x") as StoredMention["platform"],
    id: `id-${n}`,
    text: "t",
    url: "https://e/1",
    author: { name: null, handle: null },
    createdAt: iso,
    engagement: {},
    classification: {
      sentiment: over.sentiment ?? "neutral",
      signalType: "brand_mention",
      priority: over.priority ?? "P2",
      isInfluencer: false,
      isRelevant: true,
    },
    brandKey: "acme.com",
    recordedAt: iso,
  };
}

describe("computeTrendsFromMentions — volume spike (#8)", () => {
  it("flags a spike when the latest day exceeds 2x the trailing average", () => {
    // days -3,-2 have 1 each (avg 1); today has 5 → spike
    const mentions = [sm(3), sm(2), sm(0), sm(0), sm(0), sm(0), sm(0)];
    const t = computeTrendsFromMentions(mentions, "acme.com");
    expect(t.volumeByDay.length).toBeGreaterThanOrEqual(3);
    expect(t.volumeSpike.detected).toBe(true);
    expect(t.volumeSpike.latestCount).toBe(5);
  });

  it("does not flag a spike with fewer than 3 days of history", () => {
    const t = computeTrendsFromMentions([sm(0), sm(0)], "acme.com");
    expect(t.volumeSpike.detected).toBe(false);
  });

  it("does NOT flag a tiny-volume jump (1/day → 3/day, below the floor)", () => {
    // days -3,-2 have 1 each (avg 1); today has 3 → ratio trips but floor doesn't
    const mentions = [sm(3), sm(2), sm(0), sm(0), sm(0)];
    const t = computeTrendsFromMentions(mentions, "acme.com");
    expect(t.volumeSpike.detected).toBe(false);
  });
});

describe("computeTrendsFromMentions — sentiment spike (#11)", () => {
  it("flags when last-24h negative rate exceeds 2x the prior baseline (above the volume floor)", () => {
    // baseline (days 2-7): mostly positive (low neg rate); today: 5 negatives
    const baseline = [
      sm(3, { sentiment: "positive" }),
      sm(4, { sentiment: "positive" }),
      sm(5, { sentiment: "positive" }),
      sm(6, { sentiment: "neutral" }),
    ];
    const recent = [
      sm(0, { sentiment: "negative" }),
      sm(0, { sentiment: "negative" }),
      sm(0, { sentiment: "negative" }),
      sm(0, { sentiment: "negative" }),
      sm(0, { sentiment: "negative" }),
    ];
    const t = computeTrendsFromMentions([...baseline, ...recent], "acme.com");
    expect(t.sentimentSpike.recentNegativeRate).toBe(1);
    expect(t.sentimentSpike.baselineNegativeRate).toBe(0);
    expect(t.sentimentSpike.detected).toBe(true);
  });

  it("does NOT flag on a single grumpy mention (below the volume floor)", () => {
    // One negative today vs a clean baseline — 100% rate, but only 1 mention.
    const baseline = [
      sm(3, { sentiment: "positive" }),
      sm(4, { sentiment: "positive" }),
      sm(5, { sentiment: "neutral" }),
    ];
    const recent = [sm(0, { sentiment: "negative" })];
    const t = computeTrendsFromMentions([...baseline, ...recent], "acme.com");
    expect(t.sentimentSpike.recentNegativeRate).toBe(1);
    expect(t.sentimentSpike.detected).toBe(false);
  });
});

describe("computeTrendsFromMentions — share + digest", () => {
  it("computes per-platform share and a 7-day digest", () => {
    const mentions = [
      sm(0, { platform: "x", priority: "P0" }),
      sm(0, { platform: "x" }),
      sm(1, { platform: "hn" }),
    ];
    const t = computeTrendsFromMentions(mentions, "acme.com");

    const x = t.shareByPlatform.find((s) => s.platform === "x");
    expect(x?.count).toBe(2);
    expect(x?.pct).toBeCloseTo(66.7, 0);

    expect(t.digest.total).toBe(3);
    expect(t.digest.p0).toBe(1);
    expect(t.totalStored).toBe(3);
  });
});
