import { logExternalFailure } from "@/utils/log-external";

/**
 * Lightweight HTTP status probe for the error-spike signal. Issues a HEAD
 * (falling back to GET when a server rejects HEAD) following redirects, and
 * classifies the outcome. Zero vendor cost — plain fetch. Never throws.
 *
 * Redirect detection uses `res.redirected` (undici sets it when a 3xx was
 * followed); `redirect: "manual"` is unusable here because undici returns an
 * opaque, status-0 response that hides the real code.
 */

const TIMEOUT_MS = 12_000;
const USER_AGENT =
  "Mozilla/5.0 (compatible; RunAgentsSEO/1.0; +https://runagents.co/bot)";

export type UrlStatusCategory = "ok" | "redirect" | "broken" | "error";

export interface UrlStatus {
  url: string;
  statusCode: number | null;
  /** Final URL after any redirects. */
  finalUrl: string;
  redirected: boolean;
  category: UrlStatusCategory;
  error: string | null;
}

async function fetchStatus(url: string, method: "HEAD" | "GET") {
  return fetch(url, {
    method,
    redirect: "follow",
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { "User-Agent": USER_AGENT, Accept: "text/html,*/*" },
  });
}

/** Classify a single URL: ok (2xx) / redirect (3xx followed) / broken (4xx-5xx) / error. */
export async function probeUrlStatus(url: string): Promise<UrlStatus> {
  let res: Response;
  try {
    res = await fetchStatus(url, "HEAD");
    // Some servers reject HEAD with 405/501 — retry once with GET.
    if (res.status === 405 || res.status === 501) {
      res = await fetchStatus(url, "GET");
    }
  } catch (err) {
    logExternalFailure("fetch", "seo.probe-url-status", err, { url });
    return {
      url,
      statusCode: null,
      finalUrl: url,
      redirected: false,
      category: "error",
      error: err instanceof Error ? err.message : "fetch failed",
    };
  }

  const statusCode = res.status;
  const finalUrl = res.url || url;
  const redirected = res.redirected;
  let category: UrlStatusCategory;
  if (statusCode >= 400) category = "broken";
  else if (redirected) category = "redirect";
  else category = "ok";

  return { url, statusCode, finalUrl, redirected, category, error: null };
}

/** Probe many URLs with bounded concurrency. */
export async function probeUrlStatuses(
  urls: string[],
  concurrency = 8,
): Promise<UrlStatus[]> {
  const out: UrlStatus[] = new Array(urls.length);
  let cursor = 0;
  async function worker() {
    while (cursor < urls.length) {
      const i = cursor++;
      out[i] = await probeUrlStatus(urls[i]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, urls.length) }, () => worker()),
  );
  return out;
}
