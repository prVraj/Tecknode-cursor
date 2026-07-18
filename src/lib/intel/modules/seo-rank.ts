import {
  extractRankedKeywords,
  fetchDataForSeoRankedKeywords,
  type RankedKeyword,
} from "@/lib/dataforseo";
import { signalSnapshotRepo } from "@/server/db/repos/signal-snapshot.repo";
import type {
  CapabilityKey,
  ConnectorRun,
  NewSignal,
  TrackedEntity,
} from "@/server/db/schema";
import type { ModuleRunner } from "../dispatcher";
import {
  asOutput,
  getDataForSeoCredentials,
  getKeywords,
  getLocation,
} from "./module-helpers";

const CAP: CapabilityKey = "seo_rank";

// Ignore keywords below this monthly search volume — long-tail rank jitter is
// noise, not signal (mirrors the spec's min-volume floor idea).
const VOLUME_FLOOR = 20;
// When the user hasn't pinned any keywords, auto-track the top-N they rank for.
const AUTO_TOP_N = 30;
// SERP thresholds that actually matter to traffic.
const PAGE_1 = 10;
const TOP_3 = 3;
// A within-page-1 slide this big on a value keyword is worth flagging.
const BIG_DROP = 5;

type TrackedKeyword = {
  keyword: string;
  /** Organic position, or null when the domain doesn't rank for it. */
  position: number | null;
  searchVolume: number | null;
  cpc: number | null;
  competition: number | null;
  source: "user" | "auto";
};

type SeoRankPayload = {
  source: "dataforseo";
  /** Volume-weighted average organic position across the ranked portfolio
   *  (lower is better). Null when the domain ranks for nothing yet. */
  avgPosition: number | null;
  rankedCount: number;
  trackedCount: number;
  keywords: TrackedKeyword[];
  dataIssues: string[];
};

/**
 * SEO Rank — real keyword rank tracking.
 *
 * One `ranked_keywords` call returns the domain's whole ranking portfolio with
 * per-keyword position + volume + CPC + competition. From it we:
 *  - score a volume-weighted average position (the health number), and
 *  - emit CONTEXTUAL per-keyword change signals (fell off page 1, out of top 3,
 *    broke into top 3, …) by diffing against the previous snapshot.
 *
 * Tracked set = the user's pinned keywords (`payload.keywords`) if any, else the
 * top-N keywords they already rank for. Never the brand name.
 */
export const runSeoRank: ModuleRunner = async ({ entity, run }) => {
  const { login, password } = getDataForSeoCredentials("seo_rank");
  const location = getLocation(entity);
  const dataIssues: string[] = [];

  let ranked: RankedKeyword[] = [];
  try {
    const raw = await fetchDataForSeoRankedKeywords({
      domain: entity.domain,
      location,
      login,
      password,
    });
    ranked = extractRankedKeywords(raw);
  } catch (err) {
    dataIssues.push(
      `Ranked keywords unavailable: ${err instanceof Error ? err.message : "error"}`,
    );
  }

  const byKeyword = new Map(ranked.map((k) => [k.keyword.toLowerCase(), k]));
  const tracked = buildTrackedSet(entity, ranked, byKeyword);
  // Score the TRACKED set (pinned or auto top-N), not the full 350-keyword
  // portfolio — otherwise the long tail dilutes the user's actual keywords.
  const avgPosition = weightedAvgPosition(tracked);

  const payload: SeoRankPayload = {
    source: "dataforseo",
    avgPosition,
    rankedCount: ranked.length,
    trackedCount: tracked.length,
    keywords: tracked,
    dataIssues,
  };

  const signals = await buildKeywordSignals(entity, run, tracked);

  return { output: asOutput(payload), signals, costUnits: 1 };
};

/** User-pinned keywords (matched to live positions), else auto top-N by volume. */
function buildTrackedSet(
  entity: TrackedEntity,
  ranked: RankedKeyword[],
  byKeyword: Map<string, RankedKeyword>,
): TrackedKeyword[] {
  const userKeywords = getKeywords(entity);
  if (userKeywords.length > 0) {
    return userKeywords.map((kw) => {
      const m = byKeyword.get(kw.toLowerCase());
      return {
        keyword: kw,
        position: m?.position ?? null, // null = not ranking (aspirational target)
        searchVolume: m?.searchVolume ?? null,
        cpc: m?.cpc ?? null,
        competition: m?.competition ?? null,
        source: "user",
      };
    });
  }
  // Exclude branded queries from the auto set — they rank ~#1 with huge volume
  // and would peg the weighted average at 1, masking real non-branded movement.
  const branded = brandedTerms(entity);
  return ranked
    .filter((k) => k.position != null && (k.searchVolume ?? 0) >= VOLUME_FLOOR)
    .filter((k) => !branded.has(k.keyword.toLowerCase().trim()))
    .sort((a, b) => (b.searchVolume ?? 0) - (a.searchVolume ?? 0))
    .slice(0, AUTO_TOP_N)
    .map((k) => ({
      keyword: k.keyword,
      position: k.position,
      searchVolume: k.searchVolume,
      cpc: k.cpc,
      competition: k.competition,
      source: "auto",
    }));
}

/** Brand name + domain root, lowercased — filtered out of the auto keyword set. */
function brandedTerms(entity: TrackedEntity): Set<string> {
  const terms = new Set<string>();
  const brand = entity.brandName?.toLowerCase().trim();
  if (brand) terms.add(brand);
  const root = entity.domain
    .toLowerCase()
    .replace(/^www\./, "")
    .split(".")[0];
  if (root) terms.add(root);
  return terms;
}

/**
 * Volume-weighted mean organic position across the scored keywords (lower is
 * better). Skips keywords that don't rank; applies the volume floor to auto
 * keywords only — a user-pinned keyword always counts, even at low/zero volume.
 * Every kept keyword is floored to weight 1 so a zero-volume pin still counts.
 */
export function weightedAvgPosition(
  keywords: Array<{
    position: number | null;
    searchVolume: number | null;
    source?: "user" | "auto";
  }>,
): number | null {
  const scored = keywords.filter(
    (k) =>
      k.position != null &&
      (k.source === "user" || (k.searchVolume ?? 0) >= VOLUME_FLOOR),
  );
  if (scored.length === 0) return null;
  const weight = (v: number | null) => Math.max(v ?? 0, 1);
  const totalW = scored.reduce((s, k) => s + weight(k.searchVolume), 0);
  const round1 = (n: number) => Math.round(n * 10) / 10;
  return round1(
    scored.reduce(
      (s, k) => s + (k.position as number) * weight(k.searchVolume),
      0,
    ) / totalW,
  );
}

type RankEvent = {
  type: "off_page1" | "out_top3" | "drop" | "into_top3" | "onto_page1";
  severity: NewSignal["severity"];
};

/** Classify a position change into the single most important event, or null. */
export function classifyChange(
  before: number | null,
  now: number | null,
): RankEvent | null {
  // Worse (higher position = worse; null = not ranking).
  if (before != null && before <= PAGE_1 && (now == null || now > PAGE_1)) {
    return { type: "off_page1", severity: "p1" };
  }
  if (
    before != null &&
    before <= TOP_3 &&
    now != null &&
    now > TOP_3 &&
    now <= PAGE_1
  ) {
    return { type: "out_top3", severity: "p2" };
  }
  if (
    before != null &&
    now != null &&
    now - before >= BIG_DROP &&
    before <= 20
  ) {
    return { type: "drop", severity: "p2" };
  }
  // Better (wins).
  if ((before == null || before > TOP_3) && now != null && now <= TOP_3) {
    return { type: "into_top3", severity: "p3" };
  }
  if ((before == null || before > PAGE_1) && now != null && now <= PAGE_1) {
    return { type: "onto_page1", severity: "p3" };
  }
  return null;
}

function posLabel(p: number | null): string {
  return p == null ? "not ranking" : `#${p}`;
}

function titleFor(
  domain: string,
  keyword: string,
  ev: RankEvent,
  before: number | null,
  now: number | null,
): string {
  const move = `(${posLabel(before)} → ${posLabel(now)})`;
  switch (ev.type) {
    case "off_page1":
      return `${domain}: Fell off page 1 for "${keyword}" ${move}`;
    case "out_top3":
      return `${domain}: Dropped out of top 3 for "${keyword}" ${move}`;
    case "drop":
      return `${domain}: Rank slipped for "${keyword}" ${move}`;
    case "into_top3":
      return `${domain}: Broke into top 3 for "${keyword}" ${move}`;
    case "onto_page1":
      return `${domain}: Reached page 1 for "${keyword}" ${move}`;
  }
}

/** Diff each tracked keyword vs the previous snapshot → contextual signals. */
async function buildKeywordSignals(
  entity: TrackedEntity,
  run: ConnectorRun,
  tracked: TrackedKeyword[],
): Promise<NewSignal[]> {
  const today = new Date().toISOString().slice(0, 10);
  const prev = await signalSnapshotRepo.findPrevious(entity.id, CAP, today);
  const prevKeywords = (prev?.payload as SeoRankPayload | undefined)?.keywords;
  // First meaningful run (or pre-migration snapshot) → nothing to diff against.
  if (!Array.isArray(prevKeywords)) return [];

  const prevPos = new Map(
    prevKeywords.map((k) => [k.keyword.toLowerCase(), k.position]),
  );

  const signals: NewSignal[] = [];
  for (const k of tracked) {
    // Volume floor for auto keywords only — a user-pinned keyword always alerts.
    if (k.source !== "user" && (k.searchVolume ?? 0) < VOLUME_FLOOR) continue;
    const before = prevPos.get(k.keyword.toLowerCase());
    if (before === undefined) continue; // wasn't tracked before → not a change
    const ev = classifyChange(before, k.position);
    if (!ev) continue;

    const parts = [
      k.searchVolume != null
        ? `${k.searchVolume.toLocaleString()} monthly searches`
        : null,
      k.cpc != null ? `$${k.cpc.toFixed(2)} CPC` : null,
    ].filter(Boolean);

    signals.push({
      userId: entity.userId,
      subjectEntityId: entity.id,
      capabilityKey: CAP,
      severity: ev.severity,
      title: titleFor(entity.domain, k.keyword, ev, before, k.position),
      summary: parts.length > 0 ? parts.join(" · ") : null,
      evidence: {
        sourceUrl: `https://${entity.domain}`,
        runId: run.id,
        details: {
          keyword: k.keyword,
          before,
          after: k.position,
          searchVolume: k.searchVolume,
          cpc: k.cpc,
        },
      },
      confidence: "0.75",
      dedupKey: `seo_rank:${entity.id}:${k.keyword.toLowerCase()}:${ev.type}`,
    });
  }
  return signals;
}
