import {
  extractRankedKeywords,
  fetchDataForSeoRankedKeywords,
  type RankedKeyword,
} from "@/lib/dataforseo";

// ─── Types ────────────────────────────────────────────────────────────────────

export type RssItem = {
  title: string;
  url: string;
  publishedDate: string | null;
  description: string | null;
};

export type RssResult = {
  feedUrl: string | null;
  found: boolean;
  items: RssItem[];
  dataIssue?: string;
};

export type PageEntry = {
  url: string;
  estimatedTraffic: number | null;
  keywordCount: number;
  topKeyword: string | null;
  topKeywordPosition: number | null;
  topKeywordVolume: number | null;
  isNew: boolean;
};

export type CompetitorPagesResponse = {
  source: "dataforseo";
  domain: string;
  location: string;
  dataIssues: string[];
  totalPages: number;
  newPagesCount: number;
  currentPages: PageEntry[];
  newPages: PageEntry[];
  rss: RssResult | null;
};

// ─── CTR Curve ────────────────────────────────────────────────────────────────

const CTR_CURVE: Record<number, number> = {
  1: 0.285,
  2: 0.157,
  3: 0.11,
  4: 0.08,
  5: 0.072,
  6: 0.051,
  7: 0.04,
  8: 0.032,
  9: 0.028,
  10: 0.025,
  11: 0.012,
  12: 0.01,
  13: 0.009,
  14: 0.008,
  15: 0.007,
  16: 0.006,
  17: 0.005,
  18: 0.005,
  19: 0.004,
  20: 0.004,
};

function getCtr(pos: number): number {
  return CTR_CURVE[pos] ?? 0.001;
}

// ─── Domain Normalization ─────────────────────────────────────────────────────

export function normalizeDomain(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/^https?:\/\//i, "")
      .replace(/^www\./i, "")
      .split("/")[0] ?? input.toLowerCase()
  );
}

function normalizeUrl(url: string): string {
  return url.toLowerCase().replace(/\/+$/, "");
}

// ─── Top Pages Derivation ─────────────────────────────────────────────────────

export function deriveTopPages(
  keywords: RankedKeyword[],
  limit: number,
): PageEntry[] {
  const pageMap = new Map<
    string,
    {
      estimatedTraffic: number;
      keywordCount: number;
      topKeyword: string | null;
      topKeywordPosition: number | null;
      topKeywordVolume: number | null;
      topKeywordClicks: number;
    }
  >();

  for (const kw of keywords) {
    if (!kw.url) continue;
    const clicks = Math.round((kw.searchVolume ?? 0) * getCtr(kw.position));
    const existing = pageMap.get(kw.url);
    if (existing) {
      existing.estimatedTraffic += clicks;
      existing.keywordCount += 1;
      if (clicks > existing.topKeywordClicks) {
        existing.topKeyword = kw.keyword;
        existing.topKeywordPosition = kw.position;
        existing.topKeywordVolume = kw.searchVolume;
        existing.topKeywordClicks = clicks;
      }
    } else {
      pageMap.set(kw.url, {
        estimatedTraffic: clicks,
        keywordCount: 1,
        topKeyword: kw.keyword,
        topKeywordPosition: kw.position,
        topKeywordVolume: kw.searchVolume,
        topKeywordClicks: clicks,
      });
    }
  }

  return Array.from(pageMap.entries())
    .map(([url, data]) => ({
      url,
      estimatedTraffic: data.estimatedTraffic,
      keywordCount: data.keywordCount,
      topKeyword: data.topKeyword,
      topKeywordPosition: data.topKeywordPosition,
      topKeywordVolume: data.topKeywordVolume,
      isNew: false,
    }))
    .sort((a, b) => (b.estimatedTraffic ?? 0) - (a.estimatedTraffic ?? 0))
    .slice(0, limit);
}

// ─── RSS Feed Parsing ─────────────────────────────────────────────────────────

function findRssUrl(domain: string): string[] {
  const base = `https://${domain}`;
  return [
    `${base}/feed`,
    `${base}/feed.xml`,
    `${base}/rss.xml`,
    `${base}/blog/feed`,
    `${base}/atom.xml`,
  ];
}

function extractTagText(xml: string, tag: string): string | null {
  // Handles both <tag>value</tag> and <tag type="...">value</tag>
  const match = xml.match(
    new RegExp(`<${tag}(?:[^>]*)>([\\s\\S]*?)<\\/${tag}>`, "i"),
  );
  const value = match?.[1]?.replace(/<!\[CDATA\[([\s\S]*?)]]>/g, "$1").trim();
  return value || null;
}

function extractAtomLinkHref(itemXml: string): string | null {
  // Atom: <link href="https://..."/>
  const match = itemXml.match(/<link[^>]+href=["']([^"']+)["'][^>]*\/?>/i);
  return match?.[1]?.trim() || null;
}

function extractRssPlainLink(itemXml: string): string | null {
  // RSS: <link>https://...</link> — plain text, not self-closing
  const match = itemXml.match(/<link>([^<]+)<\/link>/i);
  return match?.[1]?.trim() || null;
}

function parseRssItems(xml: string): RssItem[] {
  const items: RssItem[] = [];

  // Support both RSS <item> and Atom <entry> blocks
  const blockPattern = /<(?:item|entry)[\s>]([\s\S]*?)<\/(?:item|entry)>/gi;
  let match: RegExpExecArray | null;

  // biome-ignore lint/suspicious/noAssignInExpressions: standard regex iteration pattern
  while ((match = blockPattern.exec(xml)) !== null && items.length < 20) {
    const block = match[1] ?? "";

    const title = extractTagText(block, "title") ?? "";
    const url =
      extractAtomLinkHref(block) ??
      extractRssPlainLink(block) ??
      extractTagText(block, "link") ??
      "";
    const publishedDate =
      extractTagText(block, "pubDate") ??
      extractTagText(block, "published") ??
      extractTagText(block, "updated") ??
      null;
    const description =
      extractTagText(block, "description") ??
      extractTagText(block, "summary") ??
      extractTagText(block, "content") ??
      null;

    items.push({ title, url, publishedDate, description });
  }

  return items;
}

function looksLikeFeed(body: string): boolean {
  const trimmed = body.trimStart();
  return (
    trimmed.startsWith("<?xml") ||
    trimmed.startsWith("<rss") ||
    trimmed.startsWith("<feed")
  );
}

export async function fetchRssFeed(domain: string): Promise<RssResult> {
  const candidates = findRssUrl(domain);

  for (const feedUrl of candidates) {
    try {
      const response = await fetch(feedUrl, {
        signal: AbortSignal.timeout(8000),
      });

      if (!response.ok) continue;

      const contentType = response.headers.get("content-type") ?? "";
      const body = await response.text();

      const isXmlContent =
        contentType.includes("xml") ||
        contentType.includes("rss") ||
        looksLikeFeed(body);

      if (!isXmlContent) continue;

      const items = parseRssItems(body);

      return { feedUrl, found: true, items };
    } catch {
      // Try next candidate
    }
  }

  return {
    feedUrl: null,
    found: false,
    items: [],
    dataIssue: "No RSS feed found",
  };
}

// ─── Main Builder ─────────────────────────────────────────────────────────────

export async function buildCompetitorPagesResponse({
  domain,
  previousUrls,
  location,
  limit,
  login,
  password,
  dataIssues,
}: {
  domain: string;
  previousUrls: string[];
  location?: string;
  limit: number;
  login?: string;
  password?: string;
  dataIssues: string[];
}): Promise<CompetitorPagesResponse> {
  const normalizedDomain = normalizeDomain(domain);
  const locationLabel = location ?? "United States";

  const [rankedResult, rssResult] = await Promise.allSettled([
    fetchDataForSeoRankedKeywords({
      domain,
      location,
      login,
      password,
      limit: 1000,
    }),
    fetchRssFeed(normalizedDomain),
  ]);

  // Ranked keywords → top pages
  let currentPages: PageEntry[] = [];
  if (rankedResult.status === "fulfilled") {
    const keywords = extractRankedKeywords(rankedResult.value);
    currentPages = deriveTopPages(keywords, limit);
  } else {
    const msg =
      rankedResult.reason instanceof Error
        ? rankedResult.reason.message
        : "Ranked keywords unavailable";
    dataIssues.push(`Ranked keywords fetch failed: ${msg}`);
  }

  // Normalize previousUrls for comparison
  const normalizedPreviousSet = new Set(previousUrls.map(normalizeUrl));

  // Mark new pages
  currentPages = currentPages.map((page) => ({
    ...page,
    isNew: !normalizedPreviousSet.has(normalizeUrl(page.url)),
  }));

  const newPages = currentPages.filter((p) => p.isNew);

  // RSS result
  let rss: RssResult | null = null;
  if (rssResult.status === "fulfilled") {
    rss = rssResult.value;
    if (!rss.found && rss.dataIssue) {
      dataIssues.push(rss.dataIssue);
    }
  } else {
    const msg =
      rssResult.reason instanceof Error
        ? rssResult.reason.message
        : "RSS fetch failed";
    dataIssues.push(`RSS fetch failed: ${msg}`);
  }

  return {
    source: "dataforseo",
    domain: normalizedDomain,
    location: locationLabel,
    dataIssues,
    totalPages: currentPages.length,
    newPagesCount: newPages.length,
    currentPages,
    newPages,
    rss,
  };
}
