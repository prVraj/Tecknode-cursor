import { fetchDataForSeoDomainOverview } from "@/lib/dataforseo";
import {
  buildCitationSourcesResponse,
  type CitationDomain,
  type CitationSourcesResponse,
} from "@/lib/intel/citation-sources";

export type AuthorityCitationSource = {
  domain: string;
  citationCount: number;
  frequency: number;
  domainRank: number | null;
  authorityWeightedScore: number;
  isYourDomain: boolean;
  isBacklinkOpportunity: boolean;
  exampleUrls: string[];
};

export type CitationAuthorityResponse = {
  source: "openrouter/perplexity+dataforseo";
  prompts: string[];
  yourDomain: string | null;
  dataIssues: string[];
  citedSources: AuthorityCitationSource[];
  topOpportunities: AuthorityCitationSource[];
  avgCitationSourceDR: number | null;
  yourDomainAuthority: AuthorityCitationSource | null;
};

function extractDomainRank(raw: unknown): number | null {
  if (!raw || typeof raw !== "object") return null;
  const arr = Array.isArray(raw) ? raw : [raw];
  for (const item of arr) {
    if (item && typeof item === "object") {
      const rec = item as Record<string, unknown>;
      if (typeof rec.rank === "number") return rec.rank;
      if (typeof rec.domain_rank === "number") return rec.domain_rank;
      if (Array.isArray(rec.items)) {
        for (const sub of rec.items) {
          const r = extractDomainRank(sub);
          if (r !== null) return r;
        }
      }
    }
  }
  return null;
}

function normalizeDomain(url: string): string {
  return url
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]
    .toLowerCase();
}

export async function buildCitationAuthorityResponse({
  prompts,
  yourDomain,
  limit,
  apiKey,
  dataForSeoLogin,
  dataForSeoPassword,
  citationSources,
}: {
  prompts: string[];
  yourDomain?: string;
  limit: number;
  apiKey: string;
  dataForSeoLogin?: string;
  dataForSeoPassword?: string;
  /** When provided, skips a Perplexity re-probe and derive from this snapshot. */
  citationSources?: CitationSourcesResponse;
}): Promise<CitationAuthorityResponse> {
  const dataIssues: string[] = [];

  const citationResponse =
    citationSources ??
    (await buildCitationSourcesResponse({
      prompts,
      yourDomain,
      apiKey,
    }));

  dataIssues.push(...citationResponse.dataIssues);

  const topDomains: CitationDomain[] = citationResponse.topDomains.slice(
    0,
    limit,
  );
  const normalizedYourDomain = yourDomain ? normalizeDomain(yourDomain) : null;

  // Fetch domain rank for each cited domain in parallel
  const domainRankResults = await Promise.allSettled(
    topDomains.map((d) =>
      dataForSeoLogin && dataForSeoPassword
        ? fetchDataForSeoDomainOverview({
            domain: d.domain,
            login: dataForSeoLogin,
            password: dataForSeoPassword,
          })
        : Promise.resolve(null),
    ),
  );

  const citedSources: AuthorityCitationSource[] = topDomains.map((d, i) => {
    const rankResult = domainRankResults[i];
    let domainRank: number | null = null;

    if (rankResult?.status === "fulfilled" && rankResult.value !== null) {
      domainRank = extractDomainRank(rankResult.value);
    } else if (rankResult?.status === "rejected") {
      dataIssues.push(`Domain rank fetch failed for ${d.domain}`);
    }

    const isYourDomain =
      normalizedYourDomain !== null && d.domain === normalizedYourDomain;
    const authorityWeightedScore = (d.frequency / 100) * (domainRank ?? 0);
    const isBacklinkOpportunity = (domainRank ?? 0) > 50 && !isYourDomain;

    return {
      domain: d.domain,
      citationCount: d.citationCount,
      frequency: d.frequency,
      domainRank,
      authorityWeightedScore,
      isYourDomain,
      isBacklinkOpportunity,
      exampleUrls: d.exampleUrls,
    };
  });

  citedSources.sort(
    (a, b) => b.authorityWeightedScore - a.authorityWeightedScore,
  );

  const topOpportunities = citedSources
    .filter((s) => s.isBacklinkOpportunity)
    .slice(0, 5);

  const rankedSources = citedSources.filter((s) => s.domainRank !== null);
  const avgCitationSourceDR =
    rankedSources.length > 0
      ? Math.round(
          rankedSources.reduce((sum, s) => sum + (s.domainRank ?? 0), 0) /
            rankedSources.length,
        )
      : null;

  const yourDomainAuthority =
    normalizedYourDomain !== null
      ? (citedSources.find((s) => s.isYourDomain) ?? null)
      : null;

  return {
    source: "openrouter/perplexity+dataforseo",
    prompts,
    yourDomain: normalizedYourDomain,
    dataIssues,
    citedSources,
    topOpportunities,
    avgCitationSourceDR,
    yourDomainAuthority,
  };
}
