import type { CitationSourcesResponse } from "@/lib/intel/citation-sources";
import { openrouterFetch } from "@/lib/intel/clients/openrouter-chat";
import { logExternalFailure } from "@/utils/log-external";

const SEARCH_PLATFORMS = [
  { model: "perplexity/sonar", label: "Perplexity Sonar" },
] as const;

// Both sonar variants share the same Perplexity user base — de-duplicate to single engine
const ENGINE_CONFIGS: Record<
  string,
  { label: string; monthlyQueries: number }
> = {
  Perplexity: {
    label: "Perplexity",
    monthlyQueries: 1_500_000_000,
  },
};

// Maps platform label → engine label
export function platformToEngine(label: string): string {
  if (label.startsWith("Perplexity")) return "Perplexity";
  return label;
}

// Modeled monthly query volume for an engine (0 if unknown). Exported so the
// forward-looking geo_traffic_lift signal can project against the same volumes.
export function engineMonthlyQueries(engineLabel: string): number {
  return ENGINE_CONFIGS[engineLabel]?.monthlyQueries ?? 0;
}

// AI-citation CTR curve: position → click-through rate. Exported so projection
// signals (geo_traffic_lift) model optimized positions with the same curve.
export function ctrForPosition(position: number): number {
  if (position === 1) return 0.08;
  if (position === 2) return 0.05;
  if (position === 3) return 0.035;
  if (position === 4 || position === 5) return 0.02;
  if (position >= 6) return 0.01;
  return 0;
}

const CITATION_SYSTEM_PROMPT =
  "You are a helpful assistant. When answering questions, always list your sources as URLs in a 'Citations:' section at the end of your response. Include 3-8 specific URLs directly relevant to the topic.";

const URL_REGEX = /https?:\/\/[^\s"',)\]>]+/g;

function normalizeDomain(url: string): string {
  return url
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]
    .toLowerCase();
}

function extractUrlsFromContent(content: string): string[] {
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
  let res: Response;
  try {
    res = await openrouterFetch("ai-traffic-estimate", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://runagents.co",
        "X-Title": "RunAgents Intel",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: CITATION_SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
        temperature: 0.1,
        max_tokens: 1024,
      }),
    });
  } catch (err) {
    logExternalFailure(
      "openrouter",
      "ai-traffic-estimate.fetchCitationsFromPlatform",
      err,
      { model },
    );
    return {
      citations: [],
      dataIssue: err instanceof Error ? err.message : "Network error",
    };
  }

  if (!res.ok) {
    logExternalFailure(
      "openrouter",
      "ai-traffic-estimate.fetchCitationsFromPlatform",
      new Error(`HTTP ${res.status}`),
      { model, status: res.status },
    );
    return {
      citations: [],
      dataIssue: `${model} returned HTTP ${res.status}`,
    };
  }

  const json = (await res.json()) as {
    citations?: string[];
    choices?: Array<{ message?: { content?: string } }>;
  };

  if (Array.isArray(json.citations) && json.citations.length > 0) {
    return { citations: json.citations };
  }

  const content = json.choices?.[0]?.message?.content ?? "";
  return { citations: extractUrlsFromContent(content) };
}

function findDomainPosition(
  yourDomain: string,
  citations: string[],
): number | null {
  const normalized = normalizeDomain(yourDomain);
  for (let i = 0; i < citations.length; i++) {
    const citedDomain = normalizeDomain(citations[i]);
    if (
      citedDomain === normalized ||
      citedDomain.endsWith(`.${normalized}`) ||
      normalized.endsWith(`.${citedDomain}`)
    ) {
      return i + 1; // 1-indexed
    }
  }
  return null;
}

export type EngineEstimate = {
  engine: string;
  citationRate: number;
  avgCitationPosition: number | null;
  estimatedMonthlyClicks: number;
  estimatedMonthlyImpressions: number;
  disclaimer: string;
};

export type AiTrafficEstimateResponse = {
  source: "openrouter/perplexity";
  yourDomain: string;
  prompts: string[];
  dataIssues: string[];
  engines: EngineEstimate[];
  totalEstimatedMonthlyClicks: number;
  totalEstimatedMonthlyImpressions: number;
  rawResults: Array<{
    platform: string;
    prompt: string;
    citations: string[];
    yourDomainPosition: number | null;
    dataIssue?: string;
  }>;
};

type EngineAccumulator = {
  ctrs: number[];
  positions: number[];
  totalQueries: number;
  citedCount: number;
};

function buildEngineAccumulators(): Record<string, EngineAccumulator> {
  const acc: Record<string, EngineAccumulator> = {};
  for (const key of Object.keys(ENGINE_CONFIGS)) {
    acc[key] = { ctrs: [], positions: [], totalQueries: 0, citedCount: 0 };
  }
  return acc;
}

function accumulateEngineStats(
  engineLabel: string,
  position: number | null,
  acc: Record<string, EngineAccumulator>,
): void {
  const bucket = acc[engineLabel];
  if (!bucket) return;

  bucket.totalQueries += 1;
  const ctr = position !== null ? ctrForPosition(position) : 0;
  bucket.ctrs.push(ctr);

  if (position !== null) {
    bucket.citedCount += 1;
    bucket.positions.push(position);
  }
}

function buildEngineEstimate(
  engineLabel: string,
  bucket: EngineAccumulator,
): EngineEstimate {
  const config = ENGINE_CONFIGS[engineLabel];
  const monthlyQueries = config?.monthlyQueries ?? 0;

  const avgCTR =
    bucket.ctrs.length > 0
      ? bucket.ctrs.reduce((s, v) => s + v, 0) / bucket.ctrs.length
      : 0;

  const citationRate =
    bucket.totalQueries > 0
      ? Math.round((bucket.citedCount / bucket.totalQueries) * 1000) / 10
      : 0;

  const avgCitationPosition =
    bucket.positions.length > 0
      ? Math.round(
          (bucket.positions.reduce((s, v) => s + v, 0) /
            bucket.positions.length) *
            10,
        ) / 10
      : null;

  const estimatedMonthlyClicks = Math.round(
    (citationRate / 100) * monthlyQueries * avgCTR,
  );

  const estimatedMonthlyImpressions = Math.round(
    (citationRate / 100) * monthlyQueries,
  );

  return {
    engine: engineLabel,
    citationRate,
    avgCitationPosition,
    estimatedMonthlyClicks,
    estimatedMonthlyImpressions,
    disclaimer:
      "Estimate based on modeled CTR curves and projected engine query volumes",
  };
}

function buildAiTrafficEstimateFromRawResults({
  yourDomain,
  prompts,
  dataIssues,
  rawResults,
}: {
  yourDomain: string;
  prompts: string[];
  dataIssues: string[];
  rawResults: AiTrafficEstimateResponse["rawResults"];
}): AiTrafficEstimateResponse {
  const engineAccumulators = buildEngineAccumulators();

  for (const result of rawResults) {
    const engineLabel = platformToEngine(result.platform);
    accumulateEngineStats(
      engineLabel,
      result.yourDomainPosition,
      engineAccumulators,
    );
  }

  const engines: EngineEstimate[] = Object.entries(engineAccumulators).map(
    ([label, bucket]) => buildEngineEstimate(label, bucket),
  );

  const totalEstimatedMonthlyClicks = engines.reduce(
    (s, e) => s + e.estimatedMonthlyClicks,
    0,
  );
  const totalEstimatedMonthlyImpressions = engines.reduce(
    (s, e) => s + e.estimatedMonthlyImpressions,
    0,
  );

  return {
    source: "openrouter/perplexity",
    yourDomain,
    prompts,
    dataIssues,
    engines,
    totalEstimatedMonthlyClicks,
    totalEstimatedMonthlyImpressions,
    rawResults,
  };
}

/** Derive traffic estimate from a same-day geo_citations snapshot (no LLM calls). */
export function buildAiTrafficEstimateFromCitationSources(
  citationSources: CitationSourcesResponse,
): AiTrafficEstimateResponse {
  const yourDomain =
    citationSources.yourDomain ?? citationSources.yourDomainStats?.domain ?? "";

  const rawResults: AiTrafficEstimateResponse["rawResults"] =
    citationSources.rawResults.map((result) => ({
      platform: result.platform,
      prompt: result.prompt,
      citations: result.citations,
      yourDomainPosition: yourDomain
        ? findDomainPosition(yourDomain, result.citations)
        : null,
      dataIssue: result.dataIssue,
    }));

  return buildAiTrafficEstimateFromRawResults({
    yourDomain,
    prompts: citationSources.prompts,
    dataIssues: [...citationSources.dataIssues],
    rawResults,
  });
}

export async function buildAiTrafficEstimateResponse({
  domain,
  prompts,
  apiKey,
}: {
  domain: string;
  prompts: string[];
  apiKey: string;
}): Promise<AiTrafficEstimateResponse> {
  const dataIssues: string[] = [];
  const rawResults: AiTrafficEstimateResponse["rawResults"] = [];

  const yourDomain = normalizeDomain(domain);

  const tasks = SEARCH_PLATFORMS.flatMap((platform) =>
    prompts.map((prompt) => ({ platform, prompt })),
  );

  const settled = await Promise.allSettled(
    tasks.map(({ platform, prompt }) =>
      fetchCitationsFromPlatform(prompt, platform.model, apiKey),
    ),
  );

  for (let i = 0; i < tasks.length; i++) {
    const { platform, prompt } = tasks[i];
    const outcome = settled[i];

    let citations: string[] = [];
    let dataIssue: string | undefined;

    if (outcome.status === "rejected") {
      dataIssue =
        outcome.reason instanceof Error
          ? outcome.reason.message
          : "Unknown error";
      dataIssues.push(
        `${platform.label} failed for prompt "${prompt}": ${dataIssue}`,
      );
    } else {
      citations = outcome.value.citations;
      if (outcome.value.dataIssue) {
        dataIssue = outcome.value.dataIssue;
        dataIssues.push(`${platform.label}: ${dataIssue}`);
      }
    }

    const position = findDomainPosition(yourDomain, citations);

    rawResults.push({
      platform: platform.label,
      prompt,
      citations,
      yourDomainPosition: position,
      dataIssue,
    });
  }

  return buildAiTrafficEstimateFromRawResults({
    yourDomain,
    prompts,
    dataIssues,
    rawResults,
  });
}
