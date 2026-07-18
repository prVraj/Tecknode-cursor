import { describe, expect, it } from "vitest";
import { estimateReach } from "./reach";
import type { NormalizedMention } from "./types";

function mention(over: Partial<NormalizedMention>): NormalizedMention {
  return {
    platform: "x",
    id: "1",
    text: "hi",
    url: "https://x.com/1",
    author: { name: null, handle: null },
    createdAt: new Date().toISOString(),
    engagement: {},
    ...over,
  };
}

describe("estimateReach", () => {
  it("uses real impressions when present (source=actual)", () => {
    const r = estimateReach(mention({ engagement: { impressions: 4200 } }));
    expect(r).toEqual({ value: 4200, source: "actual" });
  });

  it("estimates from followers when no impressions", () => {
    const r = estimateReach(
      mention({ author: { name: null, handle: null, followerCount: 10_000 } }),
    );
    expect(r.source).toBe("from_followers");
    expect(r.value).toBe(1000); // 10k * 0.10
  });

  it("estimates from engagement when no impressions/followers", () => {
    const r = estimateReach(
      mention({ engagement: { score: 2, comments: 1, shares: 1 } }),
    );
    expect(r.source).toBe("from_engagement");
    expect(r.value).toBe(200); // (2+1+1) * 50
  });

  it("returns 0/unknown when nothing is available", () => {
    expect(estimateReach(mention({}))).toEqual({ value: 0, source: "unknown" });
  });

  it("prefers real impressions over a follower estimate", () => {
    const r = estimateReach(
      mention({
        engagement: { impressions: 500 },
        author: { name: null, handle: null, followerCount: 1_000_000 },
      }),
    );
    expect(r.source).toBe("actual");
    expect(r.value).toBe(500);
  });

  it("ignores zero impressions and falls through", () => {
    const r = estimateReach(
      mention({
        engagement: { impressions: 0 },
        author: { name: null, handle: null, followerCount: 5000 },
      }),
    );
    expect(r.source).toBe("from_followers");
    expect(r.value).toBe(500);
  });
});
