import { describe, expect, it } from "vitest";
import {
  CAPABILITY_KEYS,
  CAPABILITY_META,
  type CapabilityKey,
  categoryForCapability,
  DEFAULT_ENABLED_CAPABILITIES,
  FIRST_RUN_CAPABILITIES,
} from "@/server/db/schema";

// Scope guardrail for the signal engine (migration Task 5). Tecknode retains
// exactly 64 of RunAgents' capabilities — 32 seo_*, 25 geo_*, and 7 named
// mentions/brand-protection keys. Every excluded prefix (audit_/landing_/
// comp_/dev_/ads_/platform_/page_/email_/uptime_/personal_) must never come
// back, whether by direct catalog re-addition or by a retained module
// importing an excluded one. This test is the tripwire for both.

const EXCLUDED_PREFIXES = [
  "audit_",
  "landing_",
  "comp_",
  "dev_",
  "ads_",
  "platform_",
  "page_",
  "email_",
  "uptime_",
  "personal_",
] as const;

const RETAINED_MENTIONS_KEYS: CapabilityKey[] = [
  "mentions_brand",
  "mentions_keyword",
  "brand_lookalike_domains",
  "brand_phishing",
  "brand_trademark_abuse",
  "social_youtube_mentions",
  "pr_news_coverage",
];

function countByCategory(prefix: "seo_" | "geo_"): number {
  return CAPABILITY_KEYS.filter((key) => key.startsWith(prefix)).length;
}

function excludedCapabilityKeys(): string[] {
  return CAPABILITY_KEYS.filter((key) =>
    EXCLUDED_PREFIXES.some((prefix) => key.startsWith(prefix)),
  );
}

describe("signal catalog scope", () => {
  it("contains exactly 64 capabilities", () => {
    expect(CAPABILITY_KEYS).toHaveLength(64);
  });

  it("has exactly 32 seo_* and 25 geo_* capabilities", () => {
    expect(countByCategory("seo_")).toBe(32);
    expect(countByCategory("geo_")).toBe(25);
  });

  it("has exactly the 7 retained mentions/brand-protection keys", () => {
    const mentionsKeys = CAPABILITY_KEYS.filter(
      (key) => categoryForCapability(key) === "mentions",
    );
    expect(mentionsKeys).toHaveLength(7);
    expect(new Set(mentionsKeys)).toEqual(new Set(RETAINED_MENTIONS_KEYS));
  });

  it("never re-admits an excluded RunAgents capability", () => {
    expect(excludedCapabilityKeys()).toEqual([]);
  });

  it("every capability key has a CAPABILITY_META entry", () => {
    for (const key of CAPABILITY_KEYS) {
      expect(CAPABILITY_META[key], `missing meta for ${key}`).toBeDefined();
    }
    expect(Object.keys(CAPABILITY_META)).toHaveLength(64);
  });

  it("categoryForCapability only ever returns seo, geo, or mentions", () => {
    for (const key of CAPABILITY_KEYS) {
      expect(["seo", "geo", "mentions"]).toContain(categoryForCapability(key));
    }
  });

  it("FIRST_RUN_CAPABILITIES is a subset of the default-enabled retained set", () => {
    for (const key of FIRST_RUN_CAPABILITIES) {
      expect(CAPABILITY_KEYS).toContain(key);
      expect(DEFAULT_ENABLED_CAPABILITIES[key]).toBe(true);
    }
  });

  // NOTE: dispatcher- and dependency-order invariants (`missingDispatcherCases`,
  // `missingDependencies`) are added once `dispatcher.ts` and
  // `capability-order.ts` land in Task 5d — they don't exist yet at the
  // catalog-pruning step and must not be faked here.
});
