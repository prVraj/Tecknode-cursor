/**
 * Keyword cannibalization detection. Cannibalization = two or more of YOUR OWN
 * URLs ranking for the same keyword in the same Google SERP. They compete with
 * each other, split clicks + link authority, and leave Google unsure which page
 * to rank — usually fixed by consolidating, canonicalizing, or redirecting.
 *
 * Method (standard DataForSEO SERP API — no Backlinks subscription needed):
 *   1. Pull the domain's ranked keywords (Labs) and take the top-N by volume.
 *   2. For each, fetch the live Google SERP (top 10) and count DISTINCT URLs of
 *      the target domain. >= 2 distinct URLs in the visible results = cannibal.
 *
 * Caveat: the SERP probe is depth-10, so cannibalization where both pages rank
 * below the first page is not detected. That's intentional — page-1 collisions
 * are the ones that actually cost clicks.
 */
import {
  extractDataForSeoSerpData,
  extractRankedKeywords,
  fetchDataForSeoRankedKeywords,
  fetchDataForSeoSerp,
  type RankedKeyword,
} from "@/lib/dataforseo";
import { logExternalFailure } from "@/utils/log-external";

const DEFAULT_MAX_KEYWORDS = 20;
const SERP_CONCURRENCY = 5;
const RANKED_KEYWORD_LIMIT = 1000;

export type CannibalizedKeyword = {
  keyword: string;
  searchVolume: number | null;
  urlCount: number;
  urls: Array<{ url: string; position: number }>;
};

export type CannibalizationResponse = {
  source: "dataforseo";
  domain: string;
  location: string;
  keywordsChecked: number;
  cannibalizedCount: number;
  cannibalized: CannibalizedKeyword[];
  dataIssues: string[];
};

function normDomain(value: string): string {
  return value
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "");
}

function isYourDomain(candidate: string, target: string): boolean {
  const c = normDomain(candidate);
  return c === target || c.endsWith(`.${target}`);
}

/** Run `fn` over `items` with bounded concurrency, preserving order. */
async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, () =>
    (async () => {
      while (cursor < items.length) {
        const i = cursor++;
        results[i] = await fn(items[i], i);
      }
    })(),
  );
  await Promise.all(workers);
  return results;
}

function topKeywordsByVolume(
  ranked: RankedKeyword[],
  max: number,
): RankedKeyword[] {
  const byKeyword = new Map<string, RankedKeyword>();
  for (const k of ranked) {
    const existing = byKeyword.get(k.keyword);
    if (!existing || (k.searchVolume ?? 0) > (existing.searchVolume ?? 0)) {
      byKeyword.set(k.keyword, k);
    }
  }
  return [...byKeyword.values()]
    .sort((a, b) => (b.searchVolume ?? 0) - (a.searchVolume ?? 0))
    .slice(0, max);
}

export async function buildCannibalizationResponse({
  domain,
  location,
  locationLabel,
  login,
  password,
  maxKeywords = DEFAULT_MAX_KEYWORDS,
}: {
  domain: string;
  location?: string;
  locationLabel: string;
  login?: string;
  password?: string;
  maxKeywords?: number;
}): Promise<CannibalizationResponse> {
  const dataIssues: string[] = [];
  const target = normDomain(domain);

  let ranked: RankedKeyword[] = [];
  try {
    const raw = await fetchDataForSeoRankedKeywords({
      domain,
      location,
      login,
      password,
      limit: RANKED_KEYWORD_LIMIT,
    });
    ranked = extractRankedKeywords(raw);
  } catch (error) {
    logExternalFailure("dataforseo", "cannibalization.rankedKeywords", error, {
      domain,
    });
    dataIssues.push(
      `Ranked keywords unavailable: ${error instanceof Error ? error.message : "unknown error"}`,
    );
    return {
      source: "dataforseo",
      domain: target,
      location: locationLabel,
      keywordsChecked: 0,
      cannibalizedCount: 0,
      cannibalized: [],
      dataIssues,
    };
  }

  const top = topKeywordsByVolume(ranked, maxKeywords);

  const probed = await mapPool(top, SERP_CONCURRENCY, async (kw) => {
    try {
      const rawSerp = await fetchDataForSeoSerp({
        keyword: kw.keyword,
        location,
        login,
        password,
      });
      const serp = extractDataForSeoSerpData(rawSerp);
      const seen = new Set<string>();
      const urls: Array<{ url: string; position: number }> = [];
      for (const o of serp.organic) {
        if (!isYourDomain(o.domain, target)) continue;
        if (seen.has(o.link)) continue;
        seen.add(o.link);
        urls.push({ url: o.link, position: o.position });
      }
      if (urls.length < 2) return null;
      return {
        keyword: kw.keyword,
        searchVolume: kw.searchVolume,
        urlCount: urls.length,
        urls: urls.sort((a, b) => a.position - b.position),
      } satisfies CannibalizedKeyword;
    } catch (error) {
      dataIssues.push(
        `SERP for "${kw.keyword}" failed: ${error instanceof Error ? error.message : "unknown error"}`,
      );
      return null;
    }
  });

  const cannibalized = probed
    .filter((c): c is CannibalizedKeyword => c !== null)
    .sort((a, b) => (b.searchVolume ?? 0) - (a.searchVolume ?? 0));

  return {
    source: "dataforseo",
    domain: target,
    location: locationLabel,
    keywordsChecked: top.length,
    cannibalizedCount: cannibalized.length,
    cannibalized,
    dataIssues,
  };
}
