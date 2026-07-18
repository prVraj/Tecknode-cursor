import { mapSite } from "@/lib/intel/clients/firecrawl";

/**
 * Trimmed, standalone port of the sitemap-mapping logic from the "competitor
 * catalog" infra (`competitor/sitemap.ts` + `competitor/helpers.ts` +
 * `competitor/types.ts`). Only the pieces needed by `fetchSitemapIntel` are
 * inlined here; the rest of that folder is out of scope.
 */

export type SitemapOk<T> = {
  ok: true;
  data: T;
  partial?: boolean;
  warning?: string;
  cost: number;
  durationMs: number;
};

export type SitemapErr = {
  ok: false;
  reason: string;
  cost: number;
  durationMs: number;
};

export type SitemapResult<T> = SitemapOk<T> | SitemapErr;

export interface SitemapIntel {
  urls: string[];
  totalCount: number;
}

/**
 * Normalize user-entered domain inputs to a fully-qualified https:// URL.
 */
function toUrl(input: string, path = ""): string {
  const host = input
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .toLowerCase()
    .replace(/^www\./, "");
  let normalizedPath = "";
  if (path) {
    normalizedPath = path.startsWith("/") ? path : `/${path}`;
  }
  return `https://${host}${normalizedPath}`;
}

/** Normalize URL: remove query strings, anchors, and trailing slashes */
function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`.replace(/\/$/, "") || u.origin;
  } catch {
    return url;
  }
}

export async function fetchSitemapIntel(
  domain: string,
): Promise<SitemapResult<SitemapIntel>> {
  const start = Date.now();
  const cost = 0.005;

  const { links } = await mapSite(toUrl(domain), 200);
  const urls = [...new Set(links.map(normalizeUrl))].filter(
    (u) => u.startsWith("http") && !u.includes("#"),
  );

  return {
    ok: true,
    data: { urls, totalCount: urls.length },
    cost,
    durationMs: Date.now() - start,
  };
}
