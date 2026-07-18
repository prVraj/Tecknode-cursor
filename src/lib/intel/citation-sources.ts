import type { GeoProbeWave } from "@/lib/intel/geo/probe-config";
import {
  buildGeoProbeRaw,
  type ProbeFetchResult,
  type ProbeTask,
  runProbeWave,
} from "@/lib/intel/geo/probe-fetch";
import {
  type EntityStateRef,
  saveGeoProbeRaw,
} from "@/lib/intel/geo/probe-state";

export type CitationDomain = {
  domain: string;
  citationCount: number; // total times cited across all prompts × platforms
  frequency: number; // % of total (platform × prompt) queries this domain appeared in (0-100)
  citedInPrompts: string[]; // which prompts triggered this citation
  citedByPlatforms: string[]; // which platforms cited this domain
  isYourDomain: boolean;
  isCompetitor: boolean;
  exampleUrls: string[]; // up to 3 example URLs from this domain
};

export type CitationSourcesRawResult = {
  platform: string;
  prompt: string;
  citations: string[];
  dataIssue?: string;
};

export type CitationSourcesResponse = {
  source: "openrouter/perplexity";
  prompts: string[];
  yourDomain: string | null;
  dataIssues: string[];
  topDomains: CitationDomain[]; // top 20 by citationCount
  yourDomainStats: CitationDomain | null;
  rawResults: CitationSourcesRawResult[];
};

function normalizeDomain(url: string): string {
  return url
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]
    .toLowerCase();
}

export type GeoProbeSaveContext = EntityStateRef & {
  runId: string;
  /** UTC date bucket `YYYY-MM-DD`; defaults to today when omitted. */
  date?: string;
};

type WaveEntry = {
  task: ProbeTask;
  outcome: PromiseSettledResult<ProbeFetchResult>;
};

export async function buildCitationSourcesResponse({
  prompts,
  yourDomain,
  competitors,
  apiKey,
  probeContext,
}: {
  prompts: string[];
  yourDomain?: string;
  competitors?: string[];
  apiKey: string;
  /** When set, this run is the daily probe producer: it fetches every wave and
   *  persists the canonical `GeoProbeRaw` so derived capabilities read it back
   *  instead of paying for their own calls. */
  probeContext?: GeoProbeSaveContext;
}): Promise<CitationSourcesResponse> {
  // As the producer we fetch the search wave too — it is what geo_mentions and
  // geo_co_citations measure, and filling it here is what lets them skip their
  // own calls. Without a probeContext we're a derived capability's live
  // fallback, so we only fetch what we ourselves need.
  const waves: GeoProbeWave[] = probeContext
    ? ["citation", "search"]
    : ["citation"];

  const byWave = await Promise.all(
    waves.map((wave) => runProbeWave(wave, prompts, apiKey)),
  );
  const entries: WaveEntry[] = byWave.flat();

  if (probeContext) {
    const probeDate =
      probeContext.date ?? new Date().toISOString().slice(0, 10);
    await saveGeoProbeRaw(
      {
        userId: probeContext.userId,
        entityId: probeContext.entityId,
        domain: probeContext.domain,
      },
      probeDate,
      buildGeoProbeRaw(entries, {
        entityId: probeContext.entityId,
        domain: probeContext.domain,
        prompts,
        runId: probeContext.runId,
      }),
    );
  }

  // Citations only exist in the citation wave; folding search-wave rows in
  // would inflate the denominator and deflate every domain's `frequency`.
  return buildCitationSourcesFromEntries(
    entries.filter((e) => e.task.wave === "citation"),
    { prompts, yourDomain, competitors },
  );
}

function buildCitationSourcesFromEntries(
  entries: WaveEntry[],
  {
    prompts,
    yourDomain,
    competitors,
  }: { prompts: string[]; yourDomain?: string; competitors?: string[] },
): CitationSourcesResponse {
  const dataIssues: string[] = [];
  const rawResults: CitationSourcesRawResult[] = [];

  const normalizedYourDomain = yourDomain ? normalizeDomain(yourDomain) : null;
  const normalizedCompetitors = (competitors ?? []).map(normalizeDomain);
  const totalTasks = entries.length;

  // domain → { count, prompts, platforms, urls }
  const domainMap = new Map<
    string,
    {
      count: number;
      prompts: Set<string>;
      platforms: Set<string>;
      urls: string[];
    }
  >();

  for (const { task, outcome } of entries) {
    const label = task.platform.label;
    const { prompt } = task;

    let citations: string[] = [];
    let dataIssue: string | undefined;

    if (outcome.status === "rejected") {
      dataIssue =
        outcome.reason instanceof Error
          ? outcome.reason.message
          : "Unknown error";
      dataIssues.push(`${label} failed for prompt "${prompt}": ${dataIssue}`);
    } else {
      citations = outcome.value.citations;
      if (outcome.value.dataIssue) {
        dataIssue = outcome.value.dataIssue;
        dataIssues.push(`${label}: ${dataIssue}`);
      }
    }

    rawResults.push({ platform: label, prompt, citations, dataIssue });

    for (const url of citations) {
      const domain = normalizeDomain(url);
      if (!domain) continue;

      const existing = domainMap.get(domain);
      if (existing) {
        existing.count += 1;
        existing.prompts.add(prompt);
        existing.platforms.add(label);
        if (existing.urls.length < 3 && !existing.urls.includes(url)) {
          existing.urls.push(url);
        }
      } else {
        domainMap.set(domain, {
          count: 1,
          prompts: new Set([prompt]),
          platforms: new Set([label]),
          urls: [url],
        });
      }
    }
  }

  const allDomains: CitationDomain[] = [];
  for (const [domain, stats] of domainMap.entries()) {
    allDomains.push({
      domain,
      citationCount: stats.count,
      frequency:
        totalTasks > 0
          ? Math.round((stats.count / totalTasks) * 100 * 10) / 10
          : 0,
      citedInPrompts: Array.from(stats.prompts),
      citedByPlatforms: Array.from(stats.platforms),
      isYourDomain:
        normalizedYourDomain !== null && domain === normalizedYourDomain,
      isCompetitor: normalizedCompetitors.includes(domain),
      exampleUrls: stats.urls,
    });
  }

  allDomains.sort((a, b) => b.citationCount - a.citationCount);

  const yourDomainStats =
    normalizedYourDomain !== null
      ? (allDomains.find((d) => d.domain === normalizedYourDomain) ?? null)
      : null;

  return {
    source: "openrouter/perplexity",
    prompts,
    yourDomain: normalizedYourDomain,
    dataIssues,
    topDomains: allDomains.slice(0, 20),
    yourDomainStats,
    rawResults,
  };
}
