import { logExternalFailure } from "@/utils/log-external";

/**
 * Lightweight page-head probe used by the SEO indexing signals
 * (seo_noindex_alert, seo_canonical_drift). Zero-cost: a single `fetch` of the
 * page, parsing the response headers + `<head>` via regex. Deliberately
 * dependency-free — we only need the robots directive and canonical link, not a
 * full DOM.
 */

const FETCH_TIMEOUT_MS = 12_000;
// A realistic UA so sites don't serve a bot-blocked variant that hides the head.
const USER_AGENT =
  "Mozilla/5.0 (compatible; RunAgentsSEO/1.0; +https://runagents.co/bot)";
// Cap how much HTML we scan — the head is always near the top.
const MAX_HTML_BYTES = 200_000;

export interface PageHead {
  url: string;
  /** URL after redirects (canonical drift should compare against this). */
  finalUrl: string;
  statusCode: number | null;
  ok: boolean;
  /** True if noindex was found in either the meta robots tag or X-Robots-Tag. */
  noindex: boolean;
  /** Where the noindex came from, for evidence. */
  noindexSource: "meta" | "header" | null;
  /** Raw robots directives we observed (meta + header), lowercased. */
  robots: string | null;
  /** Absolute canonical URL from <link rel="canonical">, or null if absent. */
  canonical: string | null;
  /** Populated when the probe could not complete (network, timeout, non-OK). */
  error: string | null;
}

function emptyHead(
  url: string,
  error: string,
  statusCode: number | null = null,
): PageHead {
  return {
    url,
    finalUrl: url,
    statusCode,
    ok: false,
    noindex: false,
    noindexSource: null,
    robots: null,
    canonical: null,
    error,
  };
}

/** Extract the `content` of a `<meta name="robots">` tag (attribute order-agnostic). */
export function parseMetaRobots(html: string): string | null {
  // Match any <meta ...> that has name="robots" (or googlebot) and a content attr.
  const tagRe = /<meta\b[^>]*>/gi;
  for (const match of html.matchAll(tagRe)) {
    const tag = match[0];
    if (!/\bname\s*=\s*["']?(?:robots|googlebot)["']?/i.test(tag)) continue;
    const content = tag.match(/\bcontent\s*=\s*["']([^"']*)["']/i);
    if (content?.[1]) return content[1].toLowerCase();
  }
  return null;
}

/** Extract and absolutize the canonical URL from `<link rel="canonical">`. */
export function parseCanonical(html: string, baseUrl: string): string | null {
  const tagRe = /<link\b[^>]*>/gi;
  for (const match of html.matchAll(tagRe)) {
    const tag = match[0];
    if (!/\brel\s*=\s*["']?canonical["']?/i.test(tag)) continue;
    const href = tag.match(/\bhref\s*=\s*["']([^"']*)["']/i);
    if (!href?.[1]) continue;
    try {
      return new URL(href[1], baseUrl).toString();
    } catch {
      return href[1];
    }
  }
  return null;
}

/**
 * Fetch a single page and return its index-relevant head data.
 * Never throws — failures are returned as `{ ok: false, error }`.
 */
export async function fetchPageHead(url: string): Promise<PageHead> {
  let res: Response;
  try {
    res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,*/*" },
    });
  } catch (err) {
    logExternalFailure("fetch", "seo.fetch-page-head", err, { url });
    return emptyHead(url, err instanceof Error ? err.message : "fetch failed");
  }

  const finalUrl = res.url || url;
  const headerRobots = res.headers.get("x-robots-tag")?.toLowerCase() ?? null;

  if (!res.ok) {
    // Non-OK (404/410/5xx) — head is meaningless, but a 404/410 on a money page
    // is itself a deindex signal the caller can interpret via statusCode.
    return {
      ...emptyHead(url, `HTTP ${res.status}`, res.status),
      finalUrl,
      robots: headerRobots,
    };
  }

  let html = "";
  try {
    const full = await res.text();
    html = full.slice(0, MAX_HTML_BYTES);
  } catch {
    return {
      ...emptyHead(url, "body read failed", res.status),
      finalUrl,
      robots: headerRobots,
    };
  }

  const metaRobots = parseMetaRobots(html);
  const headerNoindex = headerRobots?.includes("noindex") ?? false;
  const metaNoindex = metaRobots?.includes("noindex") ?? false;

  return {
    url,
    finalUrl,
    statusCode: res.status,
    ok: true,
    noindex: headerNoindex || metaNoindex,
    noindexSource: headerNoindex ? "header" : metaNoindex ? "meta" : null,
    robots: [headerRobots, metaRobots].filter(Boolean).join("; ") || null,
    canonical: parseCanonical(html, finalUrl),
    error: null,
  };
}
