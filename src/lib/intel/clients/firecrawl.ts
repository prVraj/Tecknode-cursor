/**
 * Firecrawl REST API client.
 *
 * Docs: https://docs.firecrawl.dev/api-reference
 */

import { cachedFetch } from "@/lib/intel/fetch-cache";
import {
  dollarsToMicroUsd,
  recordApiUsage,
} from "@/lib/observability/api-usage";
import { logExternalFailure } from "@/utils/log-external";

const BASE_URL = "https://api.firecrawl.dev/v1";

/** Firecrawl Hobby pricing as of 2026-06: ~$0.001 per page-credit. Used as a
 *  flat per-request estimate since the response doesn't echo back credits. */
const FIRECRAWL_USD_PER_REQUEST = 0.001;

export class FirecrawlApiError extends Error {
  readonly provider = "firecrawl" as const;
  constructor(message: string) {
    super(message);
    this.name = "FirecrawlApiError";
  }
}

async function getApiKey(): Promise<string> {
  const { env } = await import("@/env/server");
  if (!env.FIRECRAWL_API_KEY)
    throw new FirecrawlApiError("FIRECRAWL_API_KEY is not configured");
  return env.FIRECRAWL_API_KEY;
}

const RETRY_DELAYS_MS = [1_000, 3_000, 6_000];

function isTransientError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as NodeJS.ErrnoException).code ?? "";
  return (
    code === "ECONNRESET" ||
    code === "ECONNREFUSED" ||
    code === "ETIMEDOUT" ||
    code === "ENOTFOUND" ||
    err.message.includes("fetch failed")
  );
}

/** True when request() threw a non-retryable Firecrawl 4xx (auth/quota/etc).
 *  Polling loops use this to bail early instead of waiting the full deadline. */
function isFirecrawlClientError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return /^Firecrawl 4\d\d:/.test(err.message);
}

/** Returns the parsed JSON body, or throws. Returns null to signal "retry". */
async function attemptRequest<T>(
  url: string,
  options: RequestInit,
  isLastAttempt: boolean,
  attempt = 0,
): Promise<T | null> {
  const operation = url.replace(/^https?:\/\/[^/]+/, "") || url;
  const startedAt = Date.now();
  const res = await fetch(url, options).catch(async (err) => {
    await recordApiUsage({
      provider: "firecrawl",
      operation,
      unitType: "credit",
      units: 0,
      costMicroUsd: 0,
      costSource: "unknown",
      status: "error",
      errorCode: "FETCH_FAILED",
      durationMs: Date.now() - startedAt,
      attempt,
    });
    throw err;
  });
  if (res.status >= 500 && !isLastAttempt) {
    const body = await res.text().catch(() => "");
    await recordApiUsage({
      provider: "firecrawl",
      operation,
      unitType: "credit",
      units: 0,
      costMicroUsd: 0,
      costSource: "unknown",
      status: "error",
      httpStatus: res.status,
      errorCode: "RETRYABLE_5XX",
      durationMs: Date.now() - startedAt,
      attempt,
    });
    throw Object.assign(
      new FirecrawlApiError(
        `Firecrawl ${res.status}: ${body || res.statusText}`,
      ),
      { _retry: true },
    );
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    await recordApiUsage({
      provider: "firecrawl",
      operation,
      unitType: "credit",
      units: 0,
      costMicroUsd: 0,
      costSource: "unknown",
      status: "error",
      httpStatus: res.status,
      durationMs: Date.now() - startedAt,
      attempt,
    });
    throw new FirecrawlApiError(
      `Firecrawl ${res.status}: ${text || res.statusText}`,
    );
  }
  // Parse the body once so we can read it for both cost computation and the
  // caller's downstream use.
  const body = (await res.json()) as unknown;

  // Real-cost computation: Firecrawl bills per scraped page. Three endpoint
  // shapes inside this client:
  //   POST /scrape   → 1 page successfully scraped     → 1 credit
  //   POST /map      → URL discovery, ~1 page-equivalent → 1 credit
  //   POST /crawl    → queues a job (no scraping yet)  → 0 credits
  //   GET  /crawl/{id} status polls — billed only on
  //                    `status === "completed"` × `data.length`
  //                    so a 20-page crawl polled 90 times bills 20 × $0.001
  //                    (was over-counting at 90 × $0.001 before this fix).
  // Mid-poll responses ("scraping"/"failed") record 0 credits so the dashboard
  // doesn't double-charge as the poll loop accumulates partial data.
  const pages = computeFirecrawlPages(operation, body);
  await recordApiUsage({
    provider: "firecrawl",
    operation,
    unitType: "credit",
    units: pages,
    costMicroUsd: dollarsToMicroUsd(pages * FIRECRAWL_USD_PER_REQUEST),
    costSource: "table",
    status: "success",
    httpStatus: res.status,
    durationMs: Date.now() - startedAt,
    attempt,
  });
  return body as T;
}

/** How many billable pages this Firecrawl response represents. */
function computeFirecrawlPages(operation: string, body: unknown): number {
  if (operation === "/crawl") return 0; // POST queues the job, scrapes nothing
  if (operation.startsWith("/crawl/")) {
    // GET /crawl/{jobId} status poll — only charge once at completion.
    if (typeof body !== "object" || body === null) return 0;
    const b = body as { status?: string; data?: unknown[] };
    if (b.status !== "completed") return 0;
    return Array.isArray(b.data) ? b.data.length : 0;
  }
  // /scrape, /map, and any other endpoint = 1 page equivalent.
  return 1;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const key = await getApiKey();
  const init: RequestInit = {
    ...options,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  };
  const url = `${BASE_URL}${path}`;

  let lastError: unknown;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt - 1]));
    }
    const isLastAttempt = attempt === RETRY_DELAYS_MS.length;
    try {
      return (await attemptRequest<T>(url, init, isLastAttempt, attempt)) as T;
    } catch (err) {
      const retryable =
        (err as { _retry?: boolean })._retry || isTransientError(err);
      if (retryable && !isLastAttempt) {
        lastError = err;
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

// ── Public API ─────────────────────────────────────────────────────────────

export interface ScrapeResult {
  success: boolean;
  data?: {
    markdown?: string;
    html?: string;
    metadata?: Record<string, unknown>;
    links?: string[];
  };
}

export type CrawlPage = {
  markdown?: string;
  html?: string;
  metadata?: Record<string, unknown>;
  links?: string[];
  sourceURL?: string;
};

export interface CrawlResult {
  success: boolean;
  id?: string;
  data?: CrawlPage[];
}

/** Outcome of a crawl job — never throws for timeout or Firecrawl "failed" status; may still throw when starting the job fails. */
export interface CrawlOutcome {
  data: CrawlPage[];
  partial: boolean;
  warning?: string;
}

/** Emitted on each Firecrawl job poll so UIs can show live progress */
export interface CrawlPollInfo {
  jobStatus: string;
  pagesInBatch: number;
  completed?: number;
  total?: number;
}

export interface CrawlOptions {
  onPoll?: (info: CrawlPollInfo) => void | Promise<void>;
}

/** Scrape a single URL — returns markdown + metadata. Read-through cached per
 *  (url, formats) for one UTC day so sibling signals reuse one scrape. */
export async function scrape(url: string): Promise<ScrapeResult> {
  return cachedFetch({
    provider: "firecrawl",
    resource: "scrape",
    params: { url, formats: ["markdown", "html"] },
    fetcher: () =>
      request<ScrapeResult>("/scrape", {
        method: "POST",
        body: JSON.stringify({
          url,
          formats: ["markdown", "html"],
        }),
      }),
  });
}

const CRAWL_POLL_INTERVAL_MS = 2_000;
/** Max time to wait for Firecrawl job completion before accepting partial data */
const CRAWL_POLL_MAX_MS = 180_000;

type CrawlStatusResponse = {
  success: boolean;
  status: string;
  data?: CrawlPage[];
  total?: number;
  completed?: number;
};

async function fetchCrawlStatus(jobId: string): Promise<CrawlStatusResponse> {
  return request<CrawlStatusResponse>(`/crawl/${jobId}`);
}

function crawlFailedOutcome(data: CrawlPage[]): CrawlOutcome {
  return {
    data,
    partial: true,
    warning:
      data.length > 0
        ? "Firecrawl reported crawl failure; using pages collected before the failure."
        : "Firecrawl crawl failed before any pages were stored.",
  };
}

function crawlTimedOutOutcome(data: CrawlPage[], status: string): CrawlOutcome {
  return {
    data,
    partial: true,
    warning:
      data.length > 0
        ? `Crawl timed out after ${CRAWL_POLL_MAX_MS / 1000}s; using ${data.length} page(s) collected so far (status: ${status || "unknown"}).`
        : `Crawl timed out after ${CRAWL_POLL_MAX_MS / 1000}s with no pages (last status: ${status || "unknown"}).`,
  };
}

/**
 * Crawl a site — polls until completion, timeout, or Firecrawl failure.
 * Does not throw on timeout or job failure; returns whatever pages were collected (may be empty).
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: polling state machine
export async function crawl(
  url: string,
  maxPages = 20,
  options?: CrawlOptions,
): Promise<CrawlOutcome> {
  const onPoll = options?.onPoll;
  const startRes = await request<{ success: boolean; id: string }>("/crawl", {
    method: "POST",
    body: JSON.stringify({
      url,
      limit: maxPages,
      scrapeOptions: { formats: ["markdown", "html"] },
    }),
  });

  if (!startRes.success) throw new Error("Failed to start Firecrawl crawl");
  if (!startRes.id)
    throw new Error("Firecrawl crawl started but returned no job ID");

  const jobId = startRes.id;
  const deadline = Date.now() + CRAWL_POLL_MAX_MS;
  let lastData: CrawlPage[] = [];
  let lastStatus = "";

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, CRAWL_POLL_INTERVAL_MS));
    try {
      const s = await fetchCrawlStatus(jobId);
      lastData = Array.isArray(s.data) ? s.data : [];
      lastStatus = s.status;
      await onPoll?.({
        jobStatus: s.status,
        pagesInBatch: lastData.length,
        completed: s.completed,
        total: s.total,
      });
      if (s.status === "completed") return { data: lastData, partial: false };
      if (s.status === "failed") return crawlFailedOutcome(lastData);
    } catch (err) {
      // Persistent 4xx (e.g. 401 auth) is not going to recover by waiting —
      // bail immediately so the caller sees the real cause instead of a timeout.
      if (isFirecrawlClientError(err)) throw err;
      // Otherwise keep waiting for next tick — request() already retried 5xx
      // and transient network errors internally before bubbling.
    }
  }

  // One final fetch after deadline before declaring timeout
  try {
    const final = await fetchCrawlStatus(jobId);
    const finalData = Array.isArray(final.data) ? final.data : lastData;
    await onPoll?.({
      jobStatus: final.status,
      pagesInBatch: finalData.length,
      completed: final.completed,
      total: final.total,
    });
    if (final.status === "completed")
      return { data: finalData, partial: false };
    if (final.status === "failed") return crawlFailedOutcome(finalData);
    return crawlTimedOutOutcome(finalData, final.status);
  } catch (err) {
    if (isFirecrawlClientError(err)) throw err;
    return crawlTimedOutOutcome(lastData, lastStatus);
  }
}

/** Turn a single-page scrape into the same shape as crawl pages */
export function scrapeToCrawlPages(
  url: string,
  result: ScrapeResult,
): CrawlPage[] {
  if (!(result.success && result.data)) return [];
  return [
    {
      markdown: result.data.markdown,
      html: result.data.html,
      metadata: result.data.metadata,
      links: result.data.links,
      sourceURL: url,
    },
  ];
}

/** Scrape special paths — returns null if 404 / not found */
export async function scrapeOptional(
  url: string,
): Promise<ScrapeResult | null> {
  try {
    const result = await scrape(url);
    if (!result.success) {
      return null;
    }
    return result;
  } catch (err) {
    logExternalFailure("firecrawl", "firecrawl.scrapeOptional", err, { url });
    return null;
  }
}

/**
 * Map all URLs on a site via Firecrawl /map.
 * Returns a flat list of discovered URLs (no markdown, cheap call).
 *
 * `/map` is a single flat call whose cost does NOT scale with `limit`, so we
 * always fetch and cache at one ceiling (`MAP_CACHE_LIMIT`) and slice per
 * caller. This collapses every same-domain map — regardless of the caller's
 * requested `limit` — to a single fetch/day. Bump the ceiling if any caller
 * ever needs more than this many URLs.
 */
const MAP_CACHE_LIMIT = 300;

export async function mapSite(
  url: string,
  limit = 200,
): Promise<{ links: string[] }> {
  const full = await cachedFetch({
    provider: "firecrawl",
    resource: "map",
    params: { url, limit: MAP_CACHE_LIMIT },
    fetcher: async () => {
      const result = await request<{ success: boolean; links?: string[] }>(
        "/map",
        {
          method: "POST",
          body: JSON.stringify({ url, limit: MAP_CACHE_LIMIT }),
        },
      );
      return { links: result.links ?? [] };
    },
  });
  return { links: full.links.slice(0, limit) };
}
