import { z } from "zod";
import { scrape } from "@/lib/intel/clients/firecrawl";
import { intelGenerateObject } from "@/lib/intel/llm/client";
import { signalSnapshotRepo } from "@/server/db/repos/signal-snapshot.repo";
import type { NewSignal } from "@/server/db/schema";
import { logExternalFailure } from "@/utils/log-external";
import type { ModuleRunner } from "../dispatcher";
import {
  discoverRegisteredLookalikes,
  type LookalikeDomainsOutput,
} from "./brand-lookalike-domains";
import {
  getBrand,
  getCompetitorDomains,
  readTodaySnapshotPayload,
} from "./module-helpers";

const MAX_SCRAPES = 12;
const SCRAPE_CONCURRENCY = 4;
const SNIPPET_CHARS = 1200;

const VERDICTS = [
  "impersonator",
  "reseller",
  "parked",
  "unrelated",
  "legitimate",
] as const;

const classificationSchema = z.object({
  results: z.array(
    z.object({
      domain: z.string(),
      verdict: z.enum(VERDICTS),
      reason: z.string(),
      confidence: z.number().min(0).max(1),
    }),
  ),
});

type Verdict = (typeof VERDICTS)[number];

interface Infringement {
  domain: string;
  verdict: Verdict;
  reason: string;
  confidence: number;
}

function rootDomain(rawDomain: string): string {
  return rawDomain
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .split("/")[0]!
    .split(":")[0]!
    .toLowerCase();
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

export const runBrandTrademarkAbuse: ModuleRunner = async ({
  userId,
  entity,
  run,
}) => {
  const domain = rootDomain(entity.domain);
  const brand = getBrand(entity);
  const today = new Date().toISOString().slice(0, 10);
  const dataIssues: string[] = [];

  // 1. Candidate lookalikes (reuse today's snapshot, else recompute).
  const cached = await readTodaySnapshotPayload<LookalikeDomainsOutput>(
    entity.id,
    "brand_lookalike_domains",
    today,
  );
  const lookalikeDomains = cached
    ? cached.lookalikes.map((l) => l.domain)
    : (await discoverRegisteredLookalikes(domain)).map((l) => l.domain);

  // Known-legitimate domains (own + competitors) are excluded from classification.
  const competitors = new Set(await getCompetitorDomains({ userId, entity }));
  const candidates = lookalikeDomains
    .filter((d) => d !== domain && !competitors.has(d))
    .slice(0, MAX_SCRAPES);

  if (candidates.length === 0) {
    const output = {
      source: "firecrawl+openrouter",
      domain,
      candidatesScanned: 0,
      infringementCount: 0,
      infringements: [] as Infringement[],
      dataIssues: ["No registered lookalike domains to classify"],
    };
    return { output, signals: [], costUnits: 0 };
  }

  // 2. Scrape each candidate for a content snippet (skips gracefully).
  let scrapeCount = 0;
  const pages = await mapPool(candidates, SCRAPE_CONCURRENCY, async (d) => {
    try {
      const res = await scrape(`https://${d}/`);
      scrapeCount++;
      const title =
        (res.data?.metadata?.title as string | undefined) ?? "(no title)";
      const snippet = (res.data?.markdown ?? "").slice(0, SNIPPET_CHARS);
      return { domain: d, title, snippet };
    } catch (err) {
      logExternalFailure("firecrawl", "brand_trademark_abuse.scrape", err, {
        domain: d,
      });
      return { domain: d, title: "(unreachable)", snippet: "" };
    }
  });

  // ANY failed scrape drops that domain's content to empty, which the LLM then
  // classifies as non-infringing — understating `infringementCount`. Flag the
  // run as having data issues so the corrupted count isn't trusted as a
  // baseline; otherwise a later healthy run (count rises back) fires a false
  // "trademark abuse rose" alert (lower_is_better → a rise reads as bad).
  const scrapeFailures = candidates.length - scrapeCount;
  if (scrapeFailures > 0) {
    dataIssues.push(
      scrapeCount === 0
        ? "Firecrawl unavailable — could not fetch lookalike content"
        : `Firecrawl failed on ${scrapeFailures}/${candidates.length} lookalike domains — infringement count may be understated`,
    );
  }

  // 3. One LLM call classifies every scraped page.
  const corpus = pages
    .map(
      (p) =>
        `DOMAIN: ${p.domain}\nTITLE: ${p.title}\nCONTENT:\n${p.snippet || "(empty / unreachable)"}`,
    )
    .join("\n\n---\n\n");

  const { data, dataIssue } = await intelGenerateObject({
    modelTier: "scoring",
    system:
      "You are a trademark-abuse analyst. You are given web pages hosted on domains that are typo/lookalike variants of a protected brand's domain. Classify how each domain uses the brand. " +
      "Verdicts: 'impersonator' (pretends to be the brand / copies its identity), 'reseller' (sells or references the brand's products without being official), 'parked' (domain-parking / for-sale / ads placeholder), 'unrelated' (no connection to the brand), 'legitimate' (an official property of the brand). Be conservative: only use 'impersonator' with clear evidence.",
    prompt: `Protected brand: "${brand}" (official domain: ${domain}).\n\nClassify each domain below:\n\n${corpus}`,
    schema: classificationSchema,
    temperature: 0,
  });

  if (dataIssue) dataIssues.push(dataIssue);

  const infringements: Infringement[] = (data?.results ?? [])
    .filter((r) => r.verdict === "impersonator" || r.verdict === "reseller")
    .map((r) => ({
      domain: r.domain,
      verdict: r.verdict,
      reason: r.reason,
      confidence: r.confidence,
    }));

  const output = {
    source: "firecrawl+openrouter",
    domain,
    candidatesScanned: candidates.length,
    infringementCount: infringements.length,
    infringements,
    classifications: data?.results ?? [],
    dataIssues,
  };

  // ── Alerts ──────────────────────────────────────────────────────────────
  const signals: NewSignal[] = [];
  const prev = await signalSnapshotRepo.findLatest(
    entity.id,
    "brand_trademark_abuse",
  );
  const prevDomains = new Set(
    (
      (prev?.payload as { infringements?: Infringement[] } | null)
        ?.infringements ?? []
    ).map((i) => i.domain),
  );

  if (!prev && infringements.length === 0 && !dataIssue) {
    signals.push({
      userId,
      subjectEntityId: entity.id,
      capabilityKey: "brand_trademark_abuse",
      severity: "p3",
      title: `Trademark-abuse baseline for ${brand}: clean`,
      summary: `Classified ${candidates.length} lookalike domain(s); no impersonators or unauthorized resellers found.`,
      evidence: {
        sourceUrl: `https://${domain}`,
        runId: run.id,
        details: { baseline: true },
      },
      confidence: "0.8",
      dedupKey: `brand_trademark_abuse:${entity.id}:baseline`,
    });
  }

  for (const inf of infringements) {
    if (prevDomains.has(inf.domain)) continue;
    signals.push({
      userId,
      subjectEntityId: entity.id,
      capabilityKey: "brand_trademark_abuse",
      severity: inf.verdict === "impersonator" ? "p1" : "p2",
      title: `${inf.verdict === "impersonator" ? "Brand impersonator" : "Unauthorized reseller"}: ${inf.domain}`,
      summary: `${inf.reason} (confidence ${(inf.confidence * 100).toFixed(0)}%).`,
      evidence: {
        sourceUrl: `https://${inf.domain}`,
        runId: run.id,
        details: { infringement: inf },
      },
      confidence: inf.confidence.toFixed(2),
      dedupKey: `brand_trademark_abuse:${entity.id}:${inf.domain}`,
    });
  }

  return { output, signals, costUnits: scrapeCount + (data ? 1 : 0) };
};
