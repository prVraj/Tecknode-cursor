import { intelChatCompletion } from "@/lib/intel/llm/openrouter-fetch";

const CITATION_PLATFORMS = [
  { model: "perplexity/sonar", label: "Perplexity Sonar" },
] as const;

const CITATION_SYSTEM_PROMPT =
  "You are a helpful assistant. When answering questions, always list your sources as URLs in a 'Citations:' section at the end of your response. Include 3-8 specific URLs directly relevant to the topic.";

const URL_REGEX = /https?:\/\/[^\s"',)\]>]+/g;

export type KeywordCitationResult = {
  keyword: string;
  yourDomain: {
    domain: string;
    cited: boolean;
    position: number | null;
    citationCount: number;
  };
  competitors: Array<{
    domain: string;
    cited: boolean;
    position: number | null;
    citationCount: number;
  }>;
  topCitedDomain: string | null;
  competitorLeader: string | null;
  totalUniqueDomains: number;
  dataIssue?: string;
};

export type KeywordCitationMatrix = {
  source: "openrouter/perplexity";
  yourDomain: string;
  competitors: string[];
  dataIssues: string[];
  totalKeywords: number;
  keywordsWhereYouLead: number;
  keywordsWhereCompetitorLeads: number;
  keywordsNotCited: number;
  overallCitationRate: number;
  results: KeywordCitationResult[];
  competitorLeaderboard: Array<{
    domain: string;
    keywordsLed: number;
  }>;
};

function normalizeDomain(url: string): string {
  return url
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]
    .toLowerCase();
}

function extractUrlsFromText(content: string): string[] {
  const matches = content.match(URL_REGEX) ?? [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const url of matches) {
    const clean = url.replace(/[.,;:!?]$/, "");
    if (!seen.has(clean)) {
      seen.add(clean);
      result.push(clean);
    }
  }
  return result;
}

async function fetchCitationsFromPlatform(
  prompt: string,
  model: string,
  apiKey: string,
): Promise<{ citations: string[]; dataIssue?: string }> {
  const result = await intelChatCompletion({
    apiKey,
    model,
    messages: [
      { role: "system", content: CITATION_SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ],
    temperature: 0.1,
    max_tokens: 512,
    operation: "keyword-citations.fetchCitationsFromPlatform",
  });

  if (!result.ok) {
    return {
      citations: [],
      dataIssue: result.httpStatus
        ? `${model} returned HTTP ${result.httpStatus}`
        : result.dataIssue,
    };
  }

  if (result.citations && result.citations.length > 0) {
    return { citations: result.citations };
  }

  return { citations: extractUrlsFromText(result.content) };
}

async function runInChunks<T>(
  tasks: Array<() => Promise<T>>,
  chunkSize: number,
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = [];
  for (let i = 0; i < tasks.length; i += chunkSize) {
    const chunk = tasks.slice(i, i + chunkSize);
    const chunkResults = await Promise.allSettled(chunk.map((fn) => fn()));
    results.push(...chunkResults);
  }
  return results;
}

export async function buildKeywordCitationMatrix({
  domain,
  competitors,
  keywords,
  apiKey,
}: {
  domain: string;
  competitors: string[];
  keywords: string[];
  apiKey: string;
}): Promise<KeywordCitationMatrix> {
  const dataIssues: string[] = [];
  const normalizedDomain = normalizeDomain(domain);
  const normalizedCompetitors = competitors.map(normalizeDomain);

  // Tasks = keywords × CITATION_PLATFORMS
  const taskDefs = keywords.flatMap((keyword) =>
    CITATION_PLATFORMS.map((platform) => ({ keyword, platform })),
  );

  const taskFns = taskDefs.map(
    ({ keyword, platform }) =>
      () =>
        fetchCitationsFromPlatform(keyword, platform.model, apiKey),
  );

  const settled = await runInChunks(taskFns, 10);

  // Aggregate per keyword: keyword → platform → citations
  const keywordCitationMap = new Map<
    string,
    { allCitations: string[]; hasIssue: string | undefined }
  >();

  for (let i = 0; i < taskDefs.length; i++) {
    const { keyword, platform } = taskDefs[i];
    const outcome = settled[i];

    let citations: string[] = [];
    let dataIssue: string | undefined;

    if (outcome.status === "rejected") {
      dataIssue =
        outcome.reason instanceof Error
          ? outcome.reason.message
          : "Unknown error";
      dataIssues.push(
        `${platform.label} failed for keyword "${keyword}": ${dataIssue}`,
      );
    } else {
      citations = outcome.value.citations;
      if (outcome.value.dataIssue) {
        dataIssue = outcome.value.dataIssue;
        dataIssues.push(`${platform.label} [${keyword}]: ${dataIssue}`);
      }
    }

    const existing = keywordCitationMap.get(keyword);
    if (existing) {
      existing.allCitations.push(...citations);
      if (dataIssue && !existing.hasIssue) {
        existing.hasIssue = dataIssue;
      }
    } else {
      keywordCitationMap.set(keyword, {
        allCitations: citations,
        hasIssue: dataIssue,
      });
    }
  }

  // Build per-keyword results
  const results: KeywordCitationResult[] = [];

  for (const keyword of keywords) {
    const data = keywordCitationMap.get(keyword) ?? {
      allCitations: [],
      hasIssue: undefined,
    };

    // Count per domain
    const domainCountMap = new Map<string, number>();
    for (const url of data.allCitations) {
      const d = normalizeDomain(url);
      if (!d) continue;
      domainCountMap.set(d, (domainCountMap.get(d) ?? 0) + 1);
    }

    // Sort domains by citation count descending
    const sortedDomains = Array.from(domainCountMap.entries()).sort(
      (a, b) => b[1] - a[1],
    );

    const positionMap = new Map<string, number>();
    sortedDomains.forEach(([d], idx) => {
      positionMap.set(d, idx + 1);
    });

    const topCitedDomain = sortedDomains[0]?.[0] ?? null;

    const yourCount = domainCountMap.get(normalizedDomain) ?? 0;
    const yourPosition = positionMap.get(normalizedDomain) ?? null;

    const competitorResults = normalizedCompetitors.map((comp) => ({
      domain: comp,
      cited: domainCountMap.has(comp),
      position: positionMap.get(comp) ?? null,
      citationCount: domainCountMap.get(comp) ?? 0,
    }));

    // Find competitor leader: competitor with best (lowest) position that beats you
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

  // Sort: cited first, then by position ascending
  results.sort((a, b) => {
    if (a.yourDomain.cited && !b.yourDomain.cited) return -1;
    if (!a.yourDomain.cited && b.yourDomain.cited) return 1;
    const posA = a.yourDomain.position ?? Number.POSITIVE_INFINITY;
    const posB = b.yourDomain.position ?? Number.POSITIVE_INFINITY;
    return posA - posB;
  });

  // Aggregate metrics
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

  // Competitor leaderboard
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
