import { mentionRecordRepo } from "@/server/db/repos/mention-record.repo";
import { trackedEntityRepo } from "@/server/db/repos/tracked-entity.repo";
import type { MentionCapability, MentionRecord } from "@/server/db/schema";
import { clusterTopics } from "./cluster";
import { estimateReach } from "./reach";
import { loadMentions, type StoredMention } from "./store/json-store";
import { computeTrendsFromMentions } from "./store/trends";
import { PLATFORMS, type Sentiment, type SignalType } from "./types";

export const MODULE_SLUG = "brand-monitoring";

// Active mention sources. Historical `mention_records` rows may carry platforms
// since removed (github, news) — drop them on read so retired sources never
// resurface in per-platform breakdowns (byPlatform / shareByPlatform / etc.).
const ACTIVE_PLATFORMS = new Set<string>(PLATFORMS);

/** Maps a kebab data-point slug → the classifier signalType it filters on. */
const SIGNAL_SLUGS: Record<string, SignalType> = {
  churn: "churn",
  comparison: "comparison",
  "positive-churn": "positive_churn",
  "buying-intent": "buying_intent",
  "pain-points": "pain_point",
  "feature-requests": "feature_request",
};

const TREND_SLUGS = new Set([
  "trending",
  "sentiment-spike",
  // single-brand volume split across platforms (was misnamed "share-of-voice")
  "platform-distribution",
  "digest",
  "trends",
]);

const OTHER_READ_SLUGS = [
  "brand-mentions",
  "influencers",
  "sentiment-by-platform",
  "reach",
  "topics",
];

/**
 * Competitive share of voice — user-level (your volume vs each tracked
 * competitor). Handled separately from the per-entity slices below.
 */
export const COMPETITIVE_SOV_SLUG = "competitive-share-of-voice";

/** Every GET data point this module exposes. */
export const READ_DATA_POINTS = [
  ...Object.keys(SIGNAL_SLUGS),
  ...OTHER_READ_SLUGS,
  ...TREND_SLUGS,
  COMPETITIVE_SOV_SLUG,
];

/** The single POST (write) data point. */
export const WRITE_DATA_POINTS = ["scan"];

/** DB row → the in-memory StoredMention shape the slicers already understand. */
export function recordToStored(r: MentionRecord): StoredMention {
  return {
    platform: r.platform,
    id: r.externalId,
    text: r.body,
    url: r.url,
    context: r.context ?? undefined,
    author: {
      name: r.authorName,
      handle: r.authorHandle,
      followerCount: r.authorFollowers ?? undefined,
    },
    createdAt:
      r.postedAt instanceof Date
        ? r.postedAt.toISOString()
        : String(r.postedAt),
    engagement: {
      score: r.engagementScore ?? undefined,
      comments: r.comments ?? undefined,
      shares: r.shares ?? undefined,
      impressions: r.impressions ?? undefined,
    },
    classification: r.signalType
      ? {
          sentiment: (r.sentiment ?? "neutral") as Sentiment,
          signalType: r.signalType,
          priority: r.priority ?? "P2",
          isInfluencer: r.isInfluencer,
          // Persisted rows passed the relevance gate before storage.
          isRelevant: true,
        }
      : null,
    brandKey: r.entityId,
    recordedAt:
      r.firstSeenAt instanceof Date
        ? r.firstSeenAt.toISOString()
        : String(r.firstSeenAt),
  };
}

function emptySentiment(): Record<Sentiment, number> {
  return { positive: 0, neutral: 0, negative: 0 };
}

function countByPlatform(mentions: StoredMention[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of mentions) out[m.platform] = (out[m.platform] ?? 0) + 1;
  return out;
}

function sentimentByPlatform(
  mentions: StoredMention[],
): Record<string, Record<Sentiment, number>> {
  const out: Record<string, Record<Sentiment, number>> = {};
  for (const m of mentions) {
    const s = m.classification?.sentiment;
    if (!s) continue;
    out[m.platform] ??= emptySentiment();
    out[m.platform][s] += 1;
  }
  return out;
}

function trendSlice(slug: string, mentions: StoredMention[], key: string) {
  const t = computeTrendsFromMentions(mentions, key);
  if (slug === "trending") {
    return { volumeByDay: t.volumeByDay, volumeSpike: t.volumeSpike };
  }
  if (slug === "sentiment-spike") return { sentimentSpike: t.sentimentSpike };
  if (slug === "platform-distribution") {
    return { shareByPlatform: t.shareByPlatform };
  }
  if (slug === "digest") return { digest: t.digest };
  return t; // "trends" → full report
}

async function mentionSlice(
  slug: string,
  mentions: StoredMention[],
): Promise<unknown> {
  if (slug === "brand-mentions") {
    return {
      total: mentions.length,
      byPlatform: countByPlatform(mentions),
      sentimentByPlatform: sentimentByPlatform(mentions),
      items: mentions,
    };
  }
  if (slug === "influencers") {
    return {
      items: mentions.filter((m) => m.classification?.isInfluencer === true),
    };
  }
  if (slug === "sentiment-by-platform") {
    return { sentimentByPlatform: sentimentByPlatform(mentions) };
  }
  if (slug === "topics") {
    return { clusters: await clusterTopics(mentions) };
  }
  if (slug === "reach") {
    const bySource: Record<string, number> = {};
    let total = 0;
    for (const m of mentions) {
      const r = estimateReach(m);
      total += r.value;
      bySource[r.source] = (bySource[r.source] ?? 0) + r.value;
    }
    return { estimatedReach: total, reachBySource: bySource };
  }

  const signalType = SIGNAL_SLUGS[slug];
  return {
    signalType,
    items: mentions.filter((m) => m.classification?.signalType === signalType),
  };
}

function sliceDataPoint(
  slug: string,
  mentions: StoredMention[],
  key: string,
): Promise<unknown> | unknown {
  if (TREND_SLUGS.has(slug)) return trendSlice(slug, mentions, key);
  return mentionSlice(slug, mentions);
}

/** Read a data point from the JSON test store (domain-keyed, anonymous). */
export async function readDataPoint(
  domain: string,
  slug: string,
): Promise<unknown> {
  const mentions = await loadMentions(domain);
  return sliceDataPoint(slug, mentions, domain);
}

/**
 * Read a data point from `mention_records` (DB, entity-keyed).
 * `capability` narrows to brand- or keyword-driven mentions; omit for all.
 */
export async function readDataPointByEntity(
  entityId: string,
  slug: string,
  capability?: MentionCapability,
): Promise<unknown> {
  const records = await mentionRecordRepo.listByEntity(entityId, capability);
  const mentions = records
    .filter((r) => ACTIVE_PLATFORMS.has(r.platform))
    .map(recordToStored);
  return sliceDataPoint(slug, mentions, entityId);
}

export type ShareOfVoiceRow = {
  entityId: string;
  label: string;
  domain: string;
  isPrimary: boolean;
  mentions: number;
  /** Fraction of this week's user-wide mentions (0–1). */
  share: number;
  /** Fraction of last week's. */
  prevShare: number;
  /** Week-over-week change in share, in percentage points (1 decimal). */
  shiftPct: number;
};

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Competitive share of voice for a user: each tracked entity's slice of the
 * user-wide mention volume this week, plus the week-over-week shift. The
 * spec trigger fires when the primary brand's share moves ≥5 percentage
 * points WoW.
 */
export async function readCompetitiveShareOfVoice(userId: string): Promise<{
  windowDays: number;
  total: number;
  prevTotal: number;
  entities: ShareOfVoiceRow[];
  alert: { entityId: string; shiftPct: number } | null;
}> {
  const entities = await trackedEntityRepo.listByUser(userId);
  const ids = entities.map((e) => e.id);
  const now = Date.now();
  const thisStart = new Date(now - WEEK_MS);
  const lastStart = new Date(now - 2 * WEEK_MS);

  const [curr, prev] = await Promise.all([
    mentionRecordRepo.countByEntitiesBetween(ids, thisStart, new Date(now)),
    mentionRecordRepo.countByEntitiesBetween(ids, lastStart, thisStart),
  ]);
  const currMap = new Map(curr.map((r) => [r.entityId, Number(r.total)]));
  const prevMap = new Map(prev.map((r) => [r.entityId, Number(r.total)]));
  const total = [...currMap.values()].reduce((a, b) => a + b, 0);
  const prevTotal = [...prevMap.values()].reduce((a, b) => a + b, 0);

  const rows: ShareOfVoiceRow[] = entities
    .map((e) => {
      const c = currMap.get(e.id) ?? 0;
      const share = total ? c / total : 0;
      const prevShare = prevTotal ? (prevMap.get(e.id) ?? 0) / prevTotal : 0;
      return {
        entityId: e.id,
        label: e.brandName ?? e.domain,
        domain: e.domain,
        isPrimary: e.role === "primary",
        mentions: c,
        share,
        prevShare,
        shiftPct: Math.round((share - prevShare) * 1000) / 10,
      };
    })
    .sort((a, b) => b.mentions - a.mentions);

  const primary = rows.find((r) => r.isPrimary);
  const alert =
    primary && Math.abs(primary.shiftPct) >= 5
      ? { entityId: primary.entityId, shiftPct: primary.shiftPct }
      : null;

  return { windowDays: 7, total, prevTotal, entities: rows, alert };
}
