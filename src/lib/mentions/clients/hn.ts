import { logExternalFailure } from "@/utils/log-external";
import type { NormalizedMention, PlatformClient } from "../types";

type Hit = {
  objectID: string;
  title?: string | null;
  story_title?: string | null;
  comment_text?: string | null;
  story_text?: string | null;
  url?: string | null;
  author?: string | null;
  created_at?: string;
  points?: number | null;
  num_comments?: number | null;
  _tags?: string[];
};

/**
 * The Algolia HN `query` param is full-text, not boolean — a "a OR b" string
 * matches the literal token "OR" and returns ~nothing. To match ANY term we
 * run one query per term and union the hits. Capped to bound the request count.
 */
const MAX_TERMS = 5;

function searchTerms(
  brandName: string,
  domain: string,
  keywords: string[],
): string[] {
  const terms = [brandName, domain, ...keywords]
    .map((t) => t.trim())
    .filter(Boolean);
  return [...new Set(terms)].slice(0, MAX_TERMS);
}

async function searchTerm(term: string, hitsPerPage: number): Promise<Hit[]> {
  // search_by_date (not relevance "search") so new mentions aren't buried.
  const url = new URL("https://hn.algolia.com/api/v1/search_by_date");
  url.searchParams.set("query", term);
  url.searchParams.set("hitsPerPage", String(hitsPerPage));
  url.searchParams.set("tags", "(story,comment)");

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HN ${res.status}: ${res.statusText}`);
  const body = (await res.json()) as { hits?: Hit[] };
  return body.hits ?? [];
}

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function hitToMention(h: Hit): NormalizedMention | null {
  const text =
    stripHtml(h.title ?? "") ||
    stripHtml(h.story_title ?? "") ||
    stripHtml(h.comment_text ?? "") ||
    stripHtml(h.story_text ?? "");
  if (!text) return null;

  const isComment = h._tags?.includes("comment");
  return {
    platform: "hn",
    id: h.objectID,
    text,
    url: `https://news.ycombinator.com/item?id=${h.objectID}`,
    author: { name: h.author ?? null, handle: h.author ?? null },
    createdAt: h.created_at ?? new Date().toISOString(),
    engagement: {
      score: h.points ?? undefined,
      comments: h.num_comments ?? undefined,
    },
    context: isComment ? "comment" : "story",
  };
}

/**
 * #14 — current HN front page (top ~30 stories), keyed story-id → rank.
 * One unauthenticated call to the official Firebase API. Empty map on failure.
 */
async function frontPageRanks(): Promise<Map<string, number>> {
  try {
    const r = await fetch(
      "https://hacker-news.firebaseio.com/v0/topstories.json",
      { cache: "no-store" },
    );
    if (!r.ok) {
      logExternalFailure(
        "news",
        "hn.frontPageRanks",
        new Error(`HTTP ${r.status}`),
        { status: r.status },
      );
      return new Map();
    }
    const ids = (await r.json()) as number[];
    const ranks = new Map<string, number>();
    ids.slice(0, 30).forEach((id, i) => {
      ranks.set(String(id), i + 1);
    });
    return ranks;
  } catch (err) {
    logExternalFailure("news", "hn.frontPageRanks", err);
    return new Map();
  }
}

export const hnClient: PlatformClient = {
  platform: "hn",
  async search({ brandName, domain, keywords, limit }) {
    const terms = searchTerms(brandName, domain, keywords);
    const perTerm = Math.min(limit, 100);
    const hitGroups = await Promise.all(
      terms.map((t) => searchTerm(t, perTerm)),
    );

    // Union the per-term hits, dedup by objectID, cap to the requested limit.
    const byId = new Map<string, Hit>();
    for (const h of hitGroups.flat()) {
      if (!byId.has(h.objectID)) byId.set(h.objectID, h);
    }
    const mentions = [...byId.values()]
      .slice(0, limit)
      .map(hitToMention)
      .filter((m): m is NormalizedMention => m !== null);
    if (mentions.length === 0) return mentions;

    // #14: flag any matched story currently on the front page with its rank.
    const ranks = await frontPageRanks();
    return mentions.map((m) => {
      const rank = ranks.get(m.id);
      return rank ? { ...m, context: `front page #${rank}` } : m;
    });
  },
};
