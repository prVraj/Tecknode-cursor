import { waveResults } from "@/lib/intel/geo/probe-match";
import type { GeoProbeRaw } from "@/lib/intel/geo/probe-types";
import type {
  KeywordCitationMatrix,
  KeywordCitationResult,
} from "@/lib/intel/keyword-citations";

function normalizeDomain(url: string): string {
  return url
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]
    .toLowerCase();
}

/** Pure transform: GeoProbeRaw → KeywordCitationMatrix (no network). */
export function parseKeywordMatrixFromProbe(
  raw: GeoProbeRaw,
  {
    domain,
    competitors,
    keywords,
  }: {
    domain: string;
    competitors: string[];
    keywords: string[];
  },
): KeywordCitationMatrix {
  const dataIssues: string[] = [];
  const normalizedDomain = normalizeDomain(domain);
  const normalizedCompetitors = competitors.map(normalizeDomain);

  const keywordCitationMap = new Map<
    string,
    { allCitations: string[]; hasIssue: string | undefined }
  >();

  // Citation wave only — search-wave rows carry no citations.
  for (const row of waveResults(raw.results, "citation")) {
    if (!keywords.includes(row.prompt)) continue;

    const citations = row.citations;
    const dataIssue = row.dataIssue;

    if (dataIssue) {
      dataIssues.push(`${row.platformId} [${row.prompt}]: ${dataIssue}`);
    }

    const existing = keywordCitationMap.get(row.prompt);
    if (existing) {
      existing.allCitations.push(...citations);
      if (dataIssue && !existing.hasIssue) {
        existing.hasIssue = dataIssue;
      }
    } else {
      keywordCitationMap.set(row.prompt, {
        allCitations: citations,
        hasIssue: dataIssue,
      });
    }
  }

  const results: KeywordCitationResult[] = [];

  for (const keyword of keywords) {
    const data = keywordCitationMap.get(keyword) ?? {
      allCitations: [],
      hasIssue: undefined,
    };

    const domainCountMap = new Map<string, number>();
    for (const url of data.allCitations) {
      const d = normalizeDomain(url);
      if (!d) continue;
      domainCountMap.set(d, (domainCountMap.get(d) ?? 0) + 1);
    }

    const sortedDomains = Array.from(domainCountMap.entries()).sort(
      (a, b) => b[1] - a[1],
    );

    const positionMap = new Map<string, number>();
    for (let idx = 0; idx < sortedDomains.length; idx++) {
      positionMap.set(sortedDomains[idx]![0], idx + 1);
    }

    const topCitedDomain = sortedDomains[0]?.[0] ?? null;

    const yourCount = domainCountMap.get(normalizedDomain) ?? 0;
    const yourPosition = positionMap.get(normalizedDomain) ?? null;

    const competitorResults = normalizedCompetitors.map((comp) => ({
      domain: comp,
      cited: domainCountMap.has(comp),
      position: positionMap.get(comp) ?? null,
      citationCount: domainCountMap.get(comp) ?? 0,
    }));

    let competitorLeader: string | null = null;
    const yourPos = yourPosition ?? Number.POSITIVE_INFINITY;
    for (const comp of competitorResults) {
      if (comp.position !== null && comp.position < yourPos) {
        if (
          competitorLeader === null ||
          comp.position <
            (positionMap.get(competitorLeader) ?? Number.POSITIVE_INFINITY)
        ) {
          competitorLeader = comp.domain;
        }
      }
    }

    results.push({
      keyword,
      yourDomain: {
        domain: normalizedDomain,
        cited: domainCountMap.has(normalizedDomain),
        position: yourPosition,
        citationCount: yourCount,
      },
      competitors: competitorResults,
      topCitedDomain,
      competitorLeader,
      totalUniqueDomains: domainCountMap.size,
      dataIssue: data.hasIssue,
    });
  }

  results.sort((a, b) => {
    if (a.yourDomain.cited && !b.yourDomain.cited) return -1;
    if (!a.yourDomain.cited && b.yourDomain.cited) return 1;
    const posA = a.yourDomain.position ?? Number.POSITIVE_INFINITY;
    const posB = b.yourDomain.position ?? Number.POSITIVE_INFINITY;
    return posA - posB;
  });

  const keywordsWhereYouLead = results.filter(
    (r) => r.yourDomain.position === 1,
  ).length;
  const keywordsNotCited = results.filter((r) => !r.yourDomain.cited).length;
  const keywordsWhereCompetitorLeads = results.filter(
    (r) => r.competitorLeader !== null,
  ).length;
  const citedCount = results.filter((r) => r.yourDomain.cited).length;
  const overallCitationRate =
    results.length > 0 ? Math.round((citedCount / results.length) * 100) : 0;

  const compLeadMap = new Map<string, number>();
  for (const r of results) {
    if (r.competitorLeader) {
      compLeadMap.set(
        r.competitorLeader,
        (compLeadMap.get(r.competitorLeader) ?? 0) + 1,
      );
    }
  }

  const competitorLeaderboard = Array.from(compLeadMap.entries())
    .map(([d, count]) => ({ domain: d, keywordsLed: count }))
    .sort((a, b) => b.keywordsLed - a.keywordsLed);

  return {
    source: "openrouter/perplexity",
    yourDomain: normalizedDomain,
    competitors: normalizedCompetitors,
    dataIssues,
    totalKeywords: results.length,
    keywordsWhereYouLead,
    keywordsWhereCompetitorLeads,
    keywordsNotCited,
    overallCitationRate,
    results,
    competitorLeaderboard,
  };
}
