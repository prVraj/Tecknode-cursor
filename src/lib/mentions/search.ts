import { after } from "next/server";
import logger from "@/utils/logger";
import {
  BRAND_KEYWORD_COVERAGE,
  buildSignalBuckets,
  computeAggregates,
} from "./aggregate";
import { type ClassifyContext, classifyMentions } from "./classify";
import { blueskyClient } from "./clients/bluesky";
import { hnClient } from "./clients/hn";
import { productHuntClient } from "./clients/producthunt";
import { redditClient } from "./clients/reddit";
import { stackoverflowClient } from "./clients/stackoverflow";
import { wikipediaClient } from "./clients/wikipedia";
import { xClient } from "./clients/x";
import { youtubeClient } from "./clients/youtube";
import { persistMentions } from "./store/json-store";
import type {
  ClassifiedMention,
  NormalizedMention,
  Platform,
  PlatformClient,
  PlatformResult,
  SearchInput,
  SearchResponse,
} from "./types";

const CLIENTS: Record<Platform, PlatformClient> = {
  x: xClient,
  reddit: redditClient,
  hn: hnClient,
  bluesky: blueskyClient,
  youtube: youtubeClient,
  producthunt: productHuntClient,
  stackoverflow: stackoverflowClient,
  wikipedia: wikipediaClient,
};

const PLATFORM_TIMEOUT_MS = 10_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error(`Timed out after ${ms}ms`)),
      ms,
    );
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

type RawResult =
  | { platform: Platform; status: "ok"; mentions: NormalizedMention[] }
  | { platform: Platform; status: "error"; error: string }
  | { platform: Platform; status: "skipped"; reason: string };

async function runOne(
  client: PlatformClient,
  input: SearchInput,
): Promise<RawResult> {
  try {
    const mentions = await withTimeout(
      client.search(input),
      PLATFORM_TIMEOUT_MS,
    );
    if (mentions === null) {
      return {
        platform: client.platform,
        status: "skipped",
        reason: "Missing credentials in environment",
      };
    }
    return { platform: client.platform, status: "ok", mentions };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    logger.warn(`[mentions] ${client.platform} failed`, { err: msg });
    return { platform: client.platform, status: "error", error: msg };
  }
}

/** Classify across all platforms in ONE batched call, then redistribute. */
async function classifyAndDistribute(
  raw: RawResult[],
  ctx?: ClassifyContext,
): Promise<PlatformResult[]> {
  const flat: NormalizedMention[] = [];
  const spans: Array<{ platform: Platform; start: number; count: number }> = [];

  for (const r of raw) {
    if (r.status === "ok") {
      spans.push({
        platform: r.platform,
        start: flat.length,
        count: r.mentions.length,
      });
      flat.push(...r.mentions);
    }
  }

  const classified = await classifyMentions(flat, ctx);
  const bySpan = new Map<Platform, ClassifiedMention[]>();
  for (const s of spans) {
    // Relevance gate: drop coincidental keyword matches the LLM flagged so they
    // never get counted, persisted, or shown.
    const slice = classified
      .slice(s.start, s.start + s.count)
      .filter((m) => m.classification?.isRelevant !== false);
    bySpan.set(s.platform, slice);
  }

  return raw.map((r): PlatformResult => {
    if (r.status === "ok") {
      return {
        platform: r.platform,
        status: "ok",
        mentions: bySpan.get(r.platform) ?? [],
      };
    }
    return r;
  });
}

function passthrough(raw: RawResult[]): PlatformResult[] {
  return raw.map((r): PlatformResult => {
    if (r.status === "ok") {
      return {
        platform: r.platform,
        status: "ok",
        mentions: r.mentions.map((m) => ({ ...m, classification: null })),
      };
    }
    return r;
  });
}

export async function searchAllPlatforms(
  input: SearchInput,
  options?: {
    platforms?: Platform[];
    classify?: boolean;
    persist?: boolean;
    /** "brand" (must be about the company) or "keyword" (on-topic for the
     *  category; brand need not be named). Drives the relevance gate. */
    classifyMode?: "brand" | "keyword";
  },
): Promise<SearchResponse> {
  const start = Date.now();
  const targets = options?.platforms ?? (Object.keys(CLIENTS) as Platform[]);
  const shouldClassify = options?.classify ?? true;
  // JSON test store. The DB runner (intel framework) persists itself and
  // passes persist:false to avoid a redundant write.
  const shouldPersist = options?.persist ?? true;

  const raw = await Promise.all(targets.map((p) => runOne(CLIENTS[p], input)));

  const results = shouldClassify
    ? await classifyAndDistribute(raw, {
        brandName: input.brandName,
        domain: input.domain,
        keywords: input.keywords,
        mode: options?.classifyMode ?? "brand",
      })
    : passthrough(raw);

  if (shouldPersist) {
    const allMentions = results.flatMap((r) =>
      r.status === "ok" ? r.mentions : [],
    );
    // Don't block the response on disk I/O. `after()` keeps the function
    // alive until the write finishes (so it isn't lost, unlike a bare
    // fire-and-forget); outside a request context (local dev, the cron
    // runner) it throws, so we fall back to awaiting.
    const writing = persistMentions(input.domain, allMentions).catch((err) => {
      logger.warn("[mentions] persist failed", {
        err: err instanceof Error ? err.message : String(err),
      });
    });
    try {
      after(writing);
    } catch {
      await writing;
    }
  }

  const aggregates = computeAggregates(results);
  const signals = buildSignalBuckets(results, aggregates);

  return {
    query: input,
    module: "brand_keyword_monitoring",
    classified: shouldClassify,
    results,
    aggregates,
    signals,
    coverage: BRAND_KEYWORD_COVERAGE,
    durationMs: Date.now() - start,
  };
}
