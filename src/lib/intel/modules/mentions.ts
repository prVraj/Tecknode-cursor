import {
  readCompetitiveShareOfVoice,
  recordToStored,
} from "@/lib/mentions/read";
import {
  normalizeHandle,
  resolveTwitterHandle,
} from "@/lib/mentions/resolve-handle";
import { searchAllPlatforms } from "@/lib/mentions/search";
import { computeTrendsFromMentions } from "@/lib/mentions/store/trends";
import type { ClassifiedMention } from "@/lib/mentions/types";
import { mentionRecordRepo } from "@/server/db/repos/mention-record.repo";
import { trackedEntityRepo } from "@/server/db/repos/tracked-entity.repo";
import type {
  MentionCapability,
  NewMentionRecord,
  NewSignal,
  TrackedEntity,
  TrackedEntityPayload,
} from "@/server/db/schema";
import type { ModuleRunner } from "../dispatcher";
import { asOutput, getBrand, getKeywords } from "./module-helpers";

const PER_PLATFORM_LIMIT = 25;
const MAX_MENTION_SIGNALS = 25;
// Don't re-run the paid handle lookup more than once a month per entity.
const HANDLE_RESOLVE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Get the entity's X handle: read the saved one, or resolve it once (paid web
 * search) and persist it so future scans are free. A negative result is
 * cached for 30 days via `socialsResolvedAt` so we don't re-pay when there's
 * no handle. Never throws — falls back to null (X searches by brand name only).
 */
async function resolveHandleForEntity(
  entity: TrackedEntity,
): Promise<string | null> {
  const payload = (entity.payload ?? {}) as TrackedEntityPayload;
  const saved = normalizeHandle(payload.socials?.twitter);
  if (saved) return saved;

  // Negative cache: we already looked and found nothing recently.
  const lastTried = payload.socialsResolvedAt
    ? Date.parse(payload.socialsResolvedAt)
    : 0;
  if (lastTried && Date.now() - lastTried < HANDLE_RESOLVE_TTL_MS) return null;

  const handle = await resolveTwitterHandle(entity.domain);
  const nextPayload: TrackedEntityPayload = {
    ...payload,
    socialsResolvedAt: new Date().toISOString(),
    ...(handle ? { socials: { ...payload.socials, twitter: handle } } : {}),
  };
  await trackedEntityRepo.update(entity.id, entity.userId, {
    payload: nextPayload,
  });
  return handle;
}

function toRecord(
  m: ClassifiedMention,
  ctx: {
    userId: string;
    entityId: string;
    runId: string;
    capabilityKey: MentionCapability;
    capturedDate: string;
  },
): NewMentionRecord {
  const c = m.classification;
  // Guard against a malformed source timestamp: an Invalid Date would fail the
  // whole batch insert (posted_at is NOT NULL). Fall back to the capture time.
  const posted = new Date(m.createdAt);
  const postedAt = Number.isNaN(posted.getTime()) ? new Date() : posted;
  return {
    userId: ctx.userId,
    entityId: ctx.entityId,
    runId: ctx.runId,
    capabilityKey: ctx.capabilityKey,
    platform: m.platform,
    externalId: m.id,
    url: m.url,
    body: m.text,
    context: m.context ?? null,
    authorName: m.author.name ?? null,
    authorHandle: m.author.handle ?? null,
    authorFollowers: m.author.followerCount ?? null,
    engagementScore: m.engagement.score ?? null,
    comments: m.engagement.comments ?? null,
    shares: m.engagement.shares ?? null,
    impressions: m.engagement.impressions ?? null,
    sentiment: c?.sentiment ?? null,
    signalType: c?.signalType ?? null,
    priority: c?.priority ?? null,
    isInfluencer: c?.isInfluencer ?? false,
    postedAt,
    capturedDate: ctx.capturedDate,
  };
}

const SIGNAL_LABELS: Record<string, string> = {
  churn: "Churn",
  positive_churn: "Win-back",
  comparison: "Comparison",
  buying_intent: "Buying intent",
  pain_point: "Pain point",
  feature_request: "Feature request",
  brand_mention: "Mention",
};

const PRIORITY_TO_SEVERITY = { P0: "p0", P1: "p1", P2: "p2" } as const;

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

type SignalCtx = {
  userId: string;
  entityId: string;
  runId: string;
  capabilityKey: MentionCapability;
};

/** Per-mention alert for actionable mentions (P0 churn/comparison/intent + P1 pain/feature). */
function toMentionSignal(m: ClassifiedMention, ctx: SignalCtx): NewSignal {
  const c = m.classification;
  const label = c ? (SIGNAL_LABELS[c.signalType] ?? c.signalType) : "Mention";
  const who = m.author.handle ? ` — @${m.author.handle}` : "";
  return {
    userId: ctx.userId,
    subjectEntityId: ctx.entityId,
    capabilityKey: ctx.capabilityKey,
    severity: c ? PRIORITY_TO_SEVERITY[c.priority] : "p2",
    title: `${label} on ${m.platform}${who}`,
    summary: m.text.slice(0, 200),
    evidence: {
      runId: ctx.runId,
      sourceUrl: m.url,
      details: {
        platform: m.platform,
        signalType: c?.signalType ?? null,
        sentiment: c?.sentiment ?? null,
        author: m.author.handle ?? m.author.name ?? null,
        followerCount: m.author.followerCount ?? null,
        isInfluencer: c?.isInfluencer ?? false,
      },
    },
    dedupKey: `${ctx.capabilityKey}:${m.platform}:${m.id}`,
  };
}

type Trends = ReturnType<typeof computeTrendsFromMentions>;

/**
 * Trend/threshold alerts from accumulated history — the spec's marquee signals
 * (negative-sentiment spike = crisis, volume spike). Deduped per entity+day.
 * Brand-level, so only the brand capability emits them.
 */
function toTrendSignals(
  trends: Trends,
  ctx: { userId: string; entityId: string; runId: string; day: string },
): NewSignal[] {
  const out: NewSignal[] = [];
  const base = {
    userId: ctx.userId,
    subjectEntityId: ctx.entityId,
    capabilityKey: "mentions_brand" as const,
  };
  if (trends.sentimentSpike.detected) {
    out.push({
      ...base,
      severity: "p0",
      confidence: "0.70",
      title: "Negative sentiment spike",
      summary: `Negative-mention rate ${pct(trends.sentimentSpike.recentNegativeRate)} in the last 24h vs ${pct(trends.sentimentSpike.baselineNegativeRate)} baseline.`,
      evidence: { runId: ctx.runId, details: { ...trends.sentimentSpike } },
      dedupKey: `mentions_brand:sentiment-spike:${ctx.entityId}:${ctx.day}`,
    });
  }
  if (trends.volumeSpike.detected) {
    out.push({
      ...base,
      severity: "p1",
      confidence: "0.70",
      title: "Mention volume spike",
      summary: `${trends.volumeSpike.latestCount} mentions on ${trends.volumeSpike.latestDay} vs ${Math.round(trends.volumeSpike.trailingAvg)} trailing average.`,
      evidence: { runId: ctx.runId, details: { ...trends.volumeSpike } },
      dedupKey: `mentions_brand:volume-spike:${ctx.entityId}:${ctx.day}`,
    });
  }
  return out;
}

/** Competitive share-of-voice shift (>=5pt WoW). Primary entity only. */
function toSovSignal(
  sov: Awaited<ReturnType<typeof readCompetitiveShareOfVoice>>,
  ctx: { userId: string; entityId: string; runId: string; day: string },
): NewSignal | null {
  if (!sov.alert) return null;
  const dropped = sov.alert.shiftPct < 0;
  return {
    userId: ctx.userId,
    subjectEntityId: ctx.entityId,
    capabilityKey: "mentions_brand",
    severity: "p1",
    confidence: "0.70",
    title: `Share of voice ${dropped ? "dropped" : "rose"} ${Math.abs(sov.alert.shiftPct)}pts`,
    summary: `Your share of the tracked conversation shifted ${sov.alert.shiftPct}pts week-over-week.`,
    evidence: {
      runId: ctx.runId,
      details: { shiftPct: sov.alert.shiftPct, totalThisWeek: sov.total },
    },
    dedupKey: `mentions_brand:sov-shift:${ctx.entityId}:${ctx.day}`,
  };
}

const TREND_HISTORY_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Mentions module runner — fans out across all platforms, classifies, persists
 * item-level rows to `mention_records`, and returns the daily-scalar output
 * (`aggregates.totalMentions` → signal_snapshots.primaryScore) plus P0 signals.
 * `searchAllPlatforms(..., { persist: false })` — we own DB persistence here.
 */
function makeRunner(capabilityKey: MentionCapability): ModuleRunner {
  return async ({ userId, entity, run }) => {
    const handle = await resolveHandleForEntity(entity);
    const result = await searchAllPlatforms(
      {
        brandName: getBrand(entity),
        handle,
        domain: entity.domain,
        keywords: getKeywords(entity),
        limit: PER_PLATFORM_LIMIT,
      },
      {
        persist: false,
        // Keyword monitoring judges relevance by topic, not brand-name presence,
        // so category/buying-intent conversations aren't filtered out.
        classifyMode:
          capabilityKey === "mentions_keyword" ? "keyword" : "brand",
      },
    );

    const mentions = result.results.flatMap((r) =>
      r.status === "ok" ? r.mentions : [],
    );
    const capturedDate = new Date().toISOString().slice(0, 10);

    const { inserted } = await mentionRecordRepo.upsertMany(
      mentions.map((m) =>
        toRecord(m, {
          userId,
          entityId: entity.id,
          runId: run.id,
          capabilityKey,
          capturedDate,
        }),
      ),
    );

    // Per-mention alerts: P0 (churn/comparison/intent) + P1 (pain/feature).
    const signals: NewSignal[] = mentions
      .filter(
        (m) =>
          m.classification?.priority === "P0" ||
          m.classification?.priority === "P1",
      )
      .slice(0, MAX_MENTION_SIGNALS)
      .map((m) =>
        toMentionSignal(m, {
          userId,
          entityId: entity.id,
          runId: run.id,
          capabilityKey,
        }),
      );

    // Trend/threshold alerts (sentiment spike, volume spike, SoV shift) are
    // brand-level and need accumulated history — emit them from the brand run.
    if (capabilityKey === "mentions_brand") {
      const since = new Date(Date.now() - TREND_HISTORY_MS);
      const history = await mentionRecordRepo.listByEntitySince(
        entity.id,
        since,
      );
      const trends = computeTrendsFromMentions(
        history.map(recordToStored),
        entity.id,
      );
      const trendCtx = {
        userId,
        entityId: entity.id,
        runId: run.id,
        day: capturedDate,
      };
      signals.push(...toTrendSignals(trends, trendCtx));

      if (entity.role === "primary") {
        const sov = await readCompetitiveShareOfVoice(userId);
        const sovSignal = toSovSignal(sov, trendCtx);
        if (sovSignal) signals.push(sovSignal);
      }
    }

    const xReads = mentions.filter((m) => m.platform === "x").length;
    return {
      output: asOutput({ ...result, newMentions: inserted }),
      signals,
      costUnits: xReads * 0.005,
    };
  };
}

export const runMentionsBrand = makeRunner("mentions_brand");
export const runMentionsKeyword = makeRunner("mentions_keyword");
