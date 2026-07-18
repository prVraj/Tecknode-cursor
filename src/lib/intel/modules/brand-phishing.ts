import { scrape } from "@/lib/intel/clients/firecrawl";
import { signalSnapshotRepo } from "@/server/db/repos/signal-snapshot.repo";
import type { NewSignal } from "@/server/db/schema";
import { logExternalFailure } from "@/utils/log-external";
import type { ModuleRunner } from "../dispatcher";
import {
  discoverRegisteredLookalikes,
  type LookalikeDomainsOutput,
} from "./brand-lookalike-domains";
import { getBrand, readTodaySnapshotPayload } from "./module-helpers";

// Free, public phishing URL feed (no key). Refreshed continuously.
const OPENPHISH_FEED = "https://openphish.com/feed.txt";
const MAX_SCRAPES = 15;
const SCRAPE_CONCURRENCY = 4;

interface PhishingHit {
  url: string;
  domain: string;
  source: "openphish" | "content-clone";
  confidence: number;
  reasons: string[];
}

function rootDomain(rawDomain: string): string {
  return rawDomain
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .split("/")[0]!
    .split(":")[0]!
    .toLowerCase();
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return null;
  }
}

async function fetchOpenPhishHosts(): Promise<{
  urls: string[];
  dataIssue: string | null;
}> {
  try {
    const res = await fetch(OPENPHISH_FEED, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      return { urls: [], dataIssue: `OpenPhish HTTP ${res.status}` };
    }
    const text = await res.text();
    const urls = text
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("http"));
    return { urls, dataIssue: null };
  } catch (err) {
    logExternalFailure("fetch", "brand_phishing.openphish", err);
    return {
      urls: [],
      dataIssue: err instanceof Error ? err.message : "OpenPhish fetch failed",
    };
  }
}

/** Heuristic: does this scraped page look like a credential-harvesting clone? */
function detectClone(
  html: string,
  markdown: string,
  brandToken: string,
): { isClone: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const lowerHtml = html.toLowerCase();
  const lowerText = markdown.toLowerCase();

  const hasPasswordField = /<input[^>]+type=["']?password/i.test(html);
  if (hasPasswordField) reasons.push("password input field present");

  const hasForm = /<form/i.test(html);
  const loginKeywords =
    /\b(sign in|log in|login|password|account|verify your|confirm your)\b/i.test(
      lowerText,
    );
  if (hasForm && loginKeywords) reasons.push("login form + auth copy");

  const mentionsBrand =
    brandToken.length >= 3 &&
    (lowerText.includes(brandToken) || lowerHtml.includes(brandToken));
  if (mentionsBrand) reasons.push(`mentions brand "${brandToken}"`);

  // Treat as a clone only when it both impersonates the brand AND collects creds.
  const isClone = mentionsBrand && hasPasswordField;
  return { isClone, reasons };
}

async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, () =>
    (async () => {
      while (cursor < items.length) {
        const idx = cursor++;
        results[idx] = await fn(items[idx]!);
      }
    })(),
  );
  await Promise.all(workers);
  return results;
}

export const runBrandPhishing: ModuleRunner = async ({
  userId,
  entity,
  run,
}) => {
  const domain = rootDomain(entity.domain);
  const brand = getBrand(entity);
  const brandToken = domain.split(".")[0]!.toLowerCase();
  const today = new Date().toISOString().slice(0, 10);
  const dataIssues: string[] = [];

  // 1. Source candidate lookalike domains — reuse today's snapshot, else recompute.
  const cached = await readTodaySnapshotPayload<LookalikeDomainsOutput>(
    entity.id,
    "brand_lookalike_domains",
    today,
  );
  const lookalikeDomains = cached
    ? cached.lookalikes.map((l) => l.domain)
    : (await discoverRegisteredLookalikes(domain)).map((l) => l.domain);
  const lookalikeSet = new Set(lookalikeDomains);

  const hits: PhishingHit[] = [];
  const seen = new Set<string>();

  // 2. OpenPhish feed match (free, high confidence).
  const { urls: phishUrls, dataIssue: feedIssue } = await fetchOpenPhishHosts();
  if (feedIssue) dataIssues.push(feedIssue);
  for (const url of phishUrls) {
    const host = hostOf(url);
    if (!host) continue;
    const matchesLookalike = lookalikeSet.has(host);
    const matchesBrand =
      host !== domain && brandToken.length >= 4 && host.includes(brandToken);
    if (matchesLookalike || matchesBrand) {
      if (seen.has(url)) continue;
      seen.add(url);
      hits.push({
        url,
        domain: host,
        source: "openphish",
        confidence: 0.95,
        reasons: [matchesLookalike ? "lookalike domain" : "brand in hostname"],
      });
    }
  }

  // 3. Content-clone check on live lookalikes via Firecrawl (skips gracefully).
  const toScan = lookalikeDomains
    .filter((d) => !hits.some((h) => h.domain === d))
    .slice(0, MAX_SCRAPES);
  let scrapeCount = 0;
  const cloneResults = await mapPool(toScan, SCRAPE_CONCURRENCY, async (d) => {
    try {
      const res = await scrape(`https://${d}/`);
      scrapeCount++;
      const { isClone, reasons } = detectClone(
        res.data?.html ?? "",
        res.data?.markdown ?? "",
        brandToken,
      );
      return isClone
        ? ({
            url: `https://${d}/`,
            domain: d,
            source: "content-clone" as const,
            confidence: 0.7,
            reasons,
          } satisfies PhishingHit)
        : null;
    } catch (err) {
      logExternalFailure("firecrawl", "brand_phishing.scrape", err, {
        domain: d,
      });
      return null;
    }
  });
  for (const c of cloneResults) if (c) hits.push(c);

  // ANY failed scrape silently drops a possible content-clone hit, understating
  // `activePhishingCount`. Flag the run so the depressed count isn't trusted as
  // a baseline — otherwise a later healthy run (count rises back) fires a false
  // "phishing rose" alert (lower_is_better → a rise reads as bad).
  const scrapeFailures = toScan.length - scrapeCount;
  if (scrapeFailures > 0) {
    dataIssues.push(
      scrapeCount === 0
        ? "Firecrawl unavailable — content-clone detection skipped"
        : `Firecrawl failed on ${scrapeFailures}/${toScan.length} lookalike domains — phishing count may be understated`,
    );
  }

  const output = {
    source: "openphish+firecrawl",
    domain,
    lookalikesScanned: lookalikeDomains.length,
    activePhishingCount: hits.length,
    hits,
    dataIssues,
  };

  // ── Alerts ──────────────────────────────────────────────────────────────
  const signals: NewSignal[] = [];
  const prev = await signalSnapshotRepo.findLatest(entity.id, "brand_phishing");
  const prevHits = new Set(
    ((prev?.payload as { hits?: PhishingHit[] } | null)?.hits ?? []).map(
      (h) => h.url,
    ),
  );

  if (!prev && hits.length === 0) {
    signals.push({
      userId,
      subjectEntityId: entity.id,
      capabilityKey: "brand_phishing",
      severity: "p3",
      title: `Phishing baseline for ${brand}: none detected`,
      summary: `Scanned ${lookalikeDomains.length} lookalike domain(s) + OpenPhish feed. No active phishing found.`,
      evidence: {
        sourceUrl: `https://${domain}`,
        runId: run.id,
        details: { baseline: true },
      },
      confidence: "0.8",
      dedupKey: `brand_phishing:${entity.id}:baseline`,
    });
  }

  for (const hit of hits) {
    if (prevHits.has(hit.url)) continue; // already alerted
    signals.push({
      userId,
      subjectEntityId: entity.id,
      capabilityKey: "brand_phishing",
      severity: hit.source === "openphish" ? "p0" : "p1",
      title: `Phishing page impersonating ${brand}: ${hit.domain}`,
      summary: `${hit.url} — ${hit.reasons.join(", ")} (${hit.source}).`,
      evidence: {
        sourceUrl: hit.url,
        runId: run.id,
        details: { hit },
      },
      confidence: hit.confidence.toFixed(2),
      dedupKey: `brand_phishing:${entity.id}:${hit.url}`,
    });
  }

  return { output, signals, costUnits: scrapeCount };
};
