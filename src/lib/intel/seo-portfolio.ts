import type { RankedKeyword } from "@/lib/dataforseo";

/**
 * Derived SEO portfolio metrics for issue #386 P1 — position distribution,
 * traffic value, and SERP volatility. All three read the `rankedKeywords`
 * payload that `seo_keyword_changes` already fetches (keyword, position,
 * searchVolume, cpc), so they are pure derivations with no new API cost.
 */

// ── Position distribution ─────────────────────────────────────────────────────

/** The standard SEO ranking buckets Semrush/Ahrefs chart. */
export const POSITION_BUCKETS = [
  { key: "top3", label: "1–3", min: 1, max: 3 },
  { key: "top10", label: "4–10", min: 4, max: 10 },
  { key: "top20", label: "11–20", min: 11, max: 20 },
  { key: "top50", label: "21–50", min: 21, max: 50 },
  { key: "top100", label: "51–100", min: 51, max: 100 },
] as const;

export type PositionBucketKey = (typeof POSITION_BUCKETS)[number]["key"];

export interface PositionDistribution {
  buckets: Record<PositionBucketKey, number>;
  /** Keywords ranking 1–10 — the ones that actually get clicks. */
  topTen: number;
  totalKeywords: number;
}

export function buildPositionDistribution(
  keywords: RankedKeyword[],
): PositionDistribution {
  const buckets = Object.fromEntries(
    POSITION_BUCKETS.map((b) => [b.key, 0]),
  ) as Record<PositionBucketKey, number>;

  for (const kw of keywords) {
    const p = kw.position;
    if (!Number.isFinite(p) || p < 1 || p > 100) continue;
    const bucket = POSITION_BUCKETS.find((b) => p >= b.min && p <= b.max);
    if (bucket) buckets[bucket.key]++;
  }

  return {
    buckets,
    topTen: buckets.top3 + buckets.top10,
    totalKeywords: keywords.length,
  };
}

// ── Traffic value ─────────────────────────────────────────────────────────────

/**
 * Organic Google SERP click-through rate by position. Distinct from the
 * AI-citation curve in `ai-traffic-estimate.ts` (which peaks at ~8%): organic
 * position 1 draws far more, so reusing the AI curve would understate value by
 * ~3–4×. Rough industry-aggregate figures; the trend matters more than the
 * absolute, which is why the metric is framed as an estimate.
 */
export function organicCtrForPosition(position: number): number {
  if (position < 1) return 0;
  if (position === 1) return 0.28;
  if (position === 2) return 0.15;
  if (position === 3) return 0.1;
  if (position <= 5) return 0.07;
  if (position <= 10) return 0.03;
  if (position <= 20) return 0.01;
  return 0.003;
}

export interface TrafficValue {
  /** Estimated monthly organic clicks across the keyword portfolio. */
  estimatedClicks: number;
  /** clicks × CPC — what that traffic would cost via paid search. */
  monthlyValueUsd: number;
  keywordsValued: number;
}

export function buildTrafficValue(keywords: RankedKeyword[]): TrafficValue {
  let estimatedClicks = 0;
  let monthlyValueUsd = 0;
  let keywordsValued = 0;

  for (const kw of keywords) {
    const volume = kw.searchVolume;
    if (volume == null || !Number.isFinite(volume) || volume <= 0) continue;
    if (!Number.isFinite(kw.position) || kw.position < 1) continue;

    const clicks = volume * organicCtrForPosition(kw.position);
    estimatedClicks += clicks;
    // A keyword with no CPC still drives clicks, just no priceable value.
    if (kw.cpc != null && Number.isFinite(kw.cpc) && kw.cpc > 0) {
      monthlyValueUsd += clicks * kw.cpc;
      keywordsValued++;
    }
  }

  return {
    estimatedClicks: Math.round(estimatedClicks),
    monthlyValueUsd: Math.round(monthlyValueUsd),
    keywordsValued,
  };
}

// ── SERP volatility ───────────────────────────────────────────────────────────

/**
 * How much the keyword portfolio's positions moved day-over-day — the "you vs
 * Google" flux (= Semrush Sensor). High shared volatility across many keywords
 * suggests a Google algorithm update rather than a site-specific problem, which
 * lets a rank-drop alert say which it is.
 */
export interface SerpVolatility {
  /** 0–100 flux index. */
  volatility: number;
  band: "calm" | "active" | "high" | "very_high";
  /** Keywords present in both snapshots — the comparable set. */
  comparedKeywords: number;
  /** Mean absolute position change across the compared set. */
  avgPositionChange: number;
}

/** Positions this far apart are treated as churn (new/dropped), not movement. */
const MAX_TRACKED_POSITION = 100;

export function buildSerpVolatility(
  today: RankedKeyword[],
  previous: RankedKeyword[],
): SerpVolatility {
  const prevByKeyword = new Map(
    previous.map((k) => [k.keyword.toLowerCase(), k.position]),
  );

  let totalChange = 0;
  let compared = 0;
  for (const kw of today) {
    const before = prevByKeyword.get(kw.keyword.toLowerCase());
    if (before == null) continue;
    if (
      !(Number.isFinite(kw.position) && Number.isFinite(before)) ||
      kw.position > MAX_TRACKED_POSITION ||
      before > MAX_TRACKED_POSITION
    ) {
      continue;
    }
    totalChange += Math.abs(kw.position - before);
    compared++;
  }

  const avgPositionChange = compared > 0 ? totalChange / compared : 0;
  // Map mean movement onto 0–100. ~10 positions of average daily churn is
  // already extreme, so scale against that ceiling.
  const volatility = Math.min(100, Math.round((avgPositionChange / 10) * 100));

  return {
    volatility,
    band: volatilityBand(volatility),
    comparedKeywords: compared,
    avgPositionChange: Math.round(avgPositionChange * 10) / 10,
  };
}

function volatilityBand(v: number): SerpVolatility["band"] {
  if (v >= 70) return "very_high";
  if (v >= 40) return "high";
  if (v >= 15) return "active";
  return "calm";
}
