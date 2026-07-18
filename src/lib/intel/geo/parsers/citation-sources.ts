import type {
  CitationDomain,
  CitationSourcesRawResult,
  CitationSourcesResponse,
} from "@/lib/intel/citation-sources";
import { resolvePlatformLabel } from "@/lib/intel/geo/platform-labels";
import { waveResults } from "@/lib/intel/geo/probe-match";
import type { GeoProbeRaw } from "@/lib/intel/geo/probe-types";

function normalizeDomain(url: string): string {
  return url
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]
    .toLowerCase();
}

/** Pure transform: GeoProbeRaw → CitationSourcesResponse (no network I/O). */
export function parseCitationSourcesFromProbe(
  raw: GeoProbeRaw,
  {
    yourDomain,
    competitors,
  }: {
    yourDomain?: string;
    competitors?: string[];
  },
): CitationSourcesResponse {
  const dataIssues: string[] = [];
  const rawResults: CitationSourcesRawResult[] = [];
  const prompts = raw.prompts;

  // Citations only exist in the citation wave. Counting search-wave rows would
  // inflate `totalTasks` and deflate every domain's `frequency`.
  const citationRows = waveResults(raw.results, "citation");
  const totalTasks = citationRows.length;

  const normalizedYourDomain = yourDomain ? normalizeDomain(yourDomain) : null;
  const normalizedCompetitors = (competitors ?? []).map(normalizeDomain);

  const domainMap = new Map<
    string,
    {
      count: number;
      prompts: Set<string>;
      platforms: Set<string>;
      urls: string[];
    }
  >();

  for (const result of citationRows) {
    const label = resolvePlatformLabel(result.platformId, result.model);
    const { prompt, citations } = result;

    if (result.dataIssue) {
      dataIssues.push(`${label}: ${result.dataIssue}`);
    }

    rawResults.push({
      platform: label,
      prompt,
      citations,
      dataIssue: result.dataIssue,
    });

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
  const topDomains = allDomains.slice(0, 20);
  const yourDomainStats =
    normalizedYourDomain !== null
      ? (allDomains.find((d) => d.domain === normalizedYourDomain) ?? null)
      : null;

  return {
    source: "openrouter/perplexity",
    prompts,
    yourDomain: normalizedYourDomain,
    dataIssues,
    topDomains,
    yourDomainStats,
    rawResults,
  };
}
