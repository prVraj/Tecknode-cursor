import { loadMentions, type StoredMention } from "./json-store";

const DAY_MS = 24 * 60 * 60 * 1000;

function dayKey(iso: string): string {
  return iso.slice(0, 10); // YYYY-MM-DD
}

function safeDate(iso: string): number {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? Date.now() : t;
}

export type TrendsReport = {
  brandKey: string;
  totalStored: number;
  spanDays: number;
  /** #8 — daily mention volume (by post date). */
  volumeByDay: Array<{ day: string; count: number }>;
  /** #8 — spike when latest day > 2x trailing average of prior days. */
  volumeSpike: {
    detected: boolean;
    latestDay: string | null;
    latestCount: number;
    trailingAvg: number;
  };
  /** #11 — negative-sentiment rate, last 24h vs prior baseline. */
  sentimentSpike: {
    detected: boolean;
    recentNegativeRate: number;
    baselineNegativeRate: number;
    windowHours: 24;
  };
  /** #10 (partial) — volume share by platform over the whole stored span. */
  shareByPlatform: Array<{ platform: string; count: number; pct: number }>;
  /** #23 — digest for the trailing 7 days. */
  digest: {
    periodDays: 7;
    total: number;
    bySignal: Record<string, number>;
    bySentiment: Record<string, number>;
    p0: number;
  };
};

function buildVolume(mentions: StoredMention[]) {
  const byDay = new Map<string, number>();
  for (const m of mentions) {
    const k = dayKey(m.createdAt);
    byDay.set(k, (byDay.get(k) ?? 0) + 1);
  }
  const volumeByDay = [...byDay.entries()]
    .map(([day, count]) => ({ day, count }))
    .sort((a, b) => a.day.localeCompare(b.day));

  let spike = {
    detected: false,
    latestDay: null as string | null,
    latestCount: 0,
    trailingAvg: 0,
  };
  if (volumeByDay.length >= 3) {
    const latest = volumeByDay.at(-1) as { day: string; count: number };
    const prior = volumeByDay.slice(0, -1);
    const trailingAvg = prior.reduce((s, d) => s + d.count, 0) / prior.length;
    // Absolute floor, same reasoning as the sentiment spike below: at tiny
    // volumes the 2x ratio is noise (1 → 3 mentions/day is not a spike).
    const MIN_SPIKE_COUNT = 5;
    spike = {
      detected:
        latest.count >= MIN_SPIKE_COUNT &&
        trailingAvg > 0 &&
        latest.count > 2 * trailingAvg,
      latestDay: latest.day,
      latestCount: latest.count,
      trailingAvg: Number(trailingAvg.toFixed(2)),
    };
  }
  return { volumeByDay, volumeSpike: spike };
}

function buildSentimentSpike(mentions: StoredMention[]) {
  const now = Date.now();
  let recentNeg = 0;
  let recentTotal = 0;
  let baseNeg = 0;
  let baseTotal = 0;
  for (const m of mentions) {
    const age = now - safeDate(m.createdAt);
    const neg = m.classification?.sentiment === "negative" ? 1 : 0;
    if (age <= DAY_MS) {
      recentTotal += 1;
      recentNeg += neg;
    } else if (age <= 8 * DAY_MS) {
      baseTotal += 1;
      baseNeg += neg;
    }
  }
  const recentRate = recentTotal ? recentNeg / recentTotal : 0;
  const baseRate = baseTotal ? baseNeg / baseTotal : 0;
  // Absolute floor: at tiny volumes the rate is noise (one grumpy tweet =
  // 100%). Require a meaningful number of negatives before a spike can fire.
  const MIN_RECENT_NEGATIVES = 3;
  const MIN_RECENT_TOTAL = 5;
  return {
    detected:
      recentNeg >= MIN_RECENT_NEGATIVES &&
      recentTotal >= MIN_RECENT_TOTAL &&
      baseTotal > 0 &&
      recentRate > 2 * baseRate,
    recentNegativeRate: Number(recentRate.toFixed(3)),
    baselineNegativeRate: Number(baseRate.toFixed(3)),
    windowHours: 24 as const,
  };
}

function buildShare(mentions: StoredMention[]) {
  const byPlatform = new Map<string, number>();
  for (const m of mentions) {
    byPlatform.set(m.platform, (byPlatform.get(m.platform) ?? 0) + 1);
  }
  const total = mentions.length || 1;
  return [...byPlatform.entries()]
    .map(([platform, count]) => ({
      platform,
      count,
      pct: Number(((count / total) * 100).toFixed(1)),
    }))
    .sort((a, b) => b.count - a.count);
}

function buildDigest(mentions: StoredMention[]) {
  const cutoff = Date.now() - 7 * DAY_MS;
  const recent = mentions.filter((m) => safeDate(m.createdAt) >= cutoff);
  const bySignal: Record<string, number> = {};
  const bySentiment: Record<string, number> = {};
  let p0 = 0;
  for (const m of recent) {
    const c = m.classification;
    if (!c) continue;
    bySignal[c.signalType] = (bySignal[c.signalType] ?? 0) + 1;
    bySentiment[c.sentiment] = (bySentiment[c.sentiment] ?? 0) + 1;
    if (c.priority === "P0") p0 += 1;
  }
  return {
    periodDays: 7 as const,
    total: recent.length,
    bySignal,
    bySentiment,
    p0,
  };
}

/**
 * Pure computation — no I/O. Persistence swap only replaces the loader in
 * `computeTrends`; this function (and all its math) stays identical.
 */
export function computeTrendsFromMentions(
  mentions: StoredMention[],
  brandKey: string,
): TrendsReport {
  const times = mentions.map((m) => safeDate(m.createdAt));
  const spanDays =
    times.length > 1
      ? Math.ceil((Math.max(...times) - Math.min(...times)) / DAY_MS)
      : 0;

  const { volumeByDay, volumeSpike } = buildVolume(mentions);

  return {
    brandKey,
    totalStored: mentions.length,
    spanDays,
    volumeByDay,
    volumeSpike,
    sentimentSpike: buildSentimentSpike(mentions),
    shareByPlatform: buildShare(mentions),
    digest: buildDigest(mentions),
  };
}

export async function computeTrends(brandKey: string): Promise<TrendsReport> {
  const mentions = await loadMentions(brandKey);
  return computeTrendsFromMentions(mentions, brandKey);
}
