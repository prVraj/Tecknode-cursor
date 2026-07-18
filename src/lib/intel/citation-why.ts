import {
  type BacklinkItem,
  extractBacklinkItems,
  fetchDataForSeoBacklinksNewLost,
} from "@/lib/dataforseo";
import { openrouterFetch } from "@/lib/intel/clients/openrouter-chat";
import { logExternalFailure } from "@/utils/log-external";

const SEARCH_PLATFORMS = [
  { model: "perplexity/sonar-pro", label: "Perplexity Sonar Pro" },
  { model: "perplexity/sonar", label: "Perplexity Sonar" },
] as const;

const CITATION_SYSTEM_PROMPT =
  "You are a helpful assistant. When answering questions, always list your sources as URLs in a 'Citations:' section at the end of your response. Include 3-8 specific URLs directly relevant to the topic.";

const GEO_ANALYSIS_SYSTEM_PROMPT = `You are an expert in AI search engine optimization (GEO — Generative Engine Optimization).
Your job is to analyze a website's citation status in AI search engines and identify likely causal factors.

Given a domain's citation status across AI search queries and its recent backlink acquisition data, generate hypotheses for why the domain IS or ISN'T being cited.

Focus on:
1. Correlation between high-DR backlinks and citation likelihood
2. Whether anchor text matches the query topics
3. Whether lack of citations correlates with lack of authoritative backlinks on the topic
4. Concrete, actionable improvement suggestions

Return ONLY valid JSON:
{
  "cited": true,
  "overallAssessment": "<2-3 sentence summary>",
  "hypotheses": [
    {
      "type": "backlink_authority" | "topical_relevance" | "content_gap" | "brand_awareness" | "technical_seo",
      "confidence": "high" | "medium" | "low",
      "explanation": "<specific explanation>",
      "action": "<concrete next step>"
    }
  ],
  "topCausalFactors": ["<factor 1>", "<factor 2>"],
  "quickWins": ["<actionable quick win 1>", "<actionable quick win 2>"]
}`;

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
    res = await openrouterFetch("citation-why", {
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
      "citation-why.fetchCitationsFromPlatform",
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
      "citation-why.fetchCitationsFromPlatform",
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

function isDomainCited(yourDomain: string, citations: string[]): boolean {
  const normalized = normalizeDomain(yourDomain);
  return citations.some((url) => {
    const d = normalizeDomain(url);
    return d === normalized || d.endsWith(`.${normalized}`);
  });
}

type LlmAnalysisResult = {
  cited: boolean;
  overallAssessment: string | null;
  hypotheses: CitationWhyHypothesis[];
  topCausalFactors: string[];
  quickWins: string[];
  dataIssue?: string;
};

async function runGeoAnalysis(
  userMessage: string,
  apiKey: string,
): Promise<LlmAnalysisResult> {
  let res: Response;
  try {
    res = await openrouterFetch("citation-why", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://runagents.co",
        "X-Title": "RunAgents Intel",
      },
      body: JSON.stringify({
        model: "openai/gpt-4o-mini",
        messages: [
          { role: "system", content: GEO_ANALYSIS_SYSTEM_PROMPT },
          { role: "user", content: userMessage },
        ],
        temperature: 0.2,
        max_tokens: 2048,
        response_format: { type: "json_object" },
      }),
    });
  } catch (err) {
    logExternalFailure("openrouter", "citation-why.runGeoAnalysis", err);
    return {
      cited: false,
      overallAssessment: null,
      hypotheses: [],
      topCausalFactors: [],
      quickWins: [],
      dataIssue: err instanceof Error ? err.message : "Network error",
    };
  }

  if (!res.ok) {
    logExternalFailure(
      "openrouter",
      "citation-why.runGeoAnalysis",
      new Error(`HTTP ${res.status}`),
      { status: res.status },
    );
    return {
      cited: false,
      overallAssessment: null,
      hypotheses: [],
      topCausalFactors: [],
      quickWins: [],
      dataIssue: `GPT-4o-mini returned HTTP ${res.status}`,
    };
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const raw = json.choices?.[0]?.message?.content ?? "{}";

  try {
    const parsed = JSON.parse(raw) as {
      cited?: boolean;
      overallAssessment?: string;
      hypotheses?: unknown[];
      topCausalFactors?: unknown[];
      quickWins?: unknown[];
    };

    return {
      cited: Boolean(parsed.cited),
      overallAssessment:
        typeof parsed.overallAssessment === "string"
          ? parsed.overallAssessment
          : null,
      hypotheses: parseHypotheses(parsed.hypotheses),
      topCausalFactors: parseStringArray(parsed.topCausalFactors),
      quickWins: parseStringArray(parsed.quickWins),
    };
  } catch (err) {
    logExternalFailure("openrouter", "citation-why.runGeoAnalysis", err);
    return {
      cited: false,
      overallAssessment: null,
      hypotheses: [],
      topCausalFactors: [],
      quickWins: [],
      dataIssue: "Failed to parse LLM JSON response",
    };
  }
}

function parseHypotheses(raw: unknown): CitationWhyHypothesis[] {
  if (!Array.isArray(raw)) return [];
  const validTypes = new Set([
    "backlink_authority",
    "topical_relevance",
    "content_gap",
    "brand_awareness",
    "technical_seo",
  ]);
  const validConfidences = new Set(["high", "medium", "low"]);

  const result: CitationWhyHypothesis[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const h = item as Record<string, unknown>;
    if (!validTypes.has(String(h.type))) continue;
    if (!validConfidences.has(String(h.confidence))) continue;
    result.push({
      type: h.type as CitationWhyHypothesis["type"],
      confidence: h.confidence as CitationWhyHypothesis["confidence"],
      explanation: typeof h.explanation === "string" ? h.explanation : "",
      action: typeof h.action === "string" ? h.action : "",
    });
  }
  return result;
}

function parseStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((s): s is string => typeof s === "string");
}

function buildBacklinkSummaryLines(backlinks: BacklinkItem[]): string[] {
  return backlinks.slice(0, 30).map((b) => {
    const dr = b.domainRank !== null ? `DR${b.domainRank}` : "DR?";
    const anchor = b.anchorText ? `"${b.anchorText}"` : "(no anchor)";
    const seen = b.firstSeen ?? "unknown date";
    return `  - ${b.sourceDomain} (${dr}, ${anchor}, first seen ${seen})`;
  });
}

function buildUserMessage({
  yourDomain,
  citedInQueries,
  notCitedInQueries,
  totalQueries,
  backlinkLines,
}: {
  yourDomain: string;
  citedInQueries: string[];
  notCitedInQueries: string[];
  totalQueries: number;
  backlinkLines: string[];
}): string {
  const citedCount = citedInQueries.length;
  const citedList =
    citedInQueries.length > 0
      ? citedInQueries.map((q) => `  - ${q}`).join("\n")
      : "  (none)";
  const notCitedList =
    notCitedInQueries.length > 0
      ? notCitedInQueries.map((q) => `  - ${q}`).join("\n")
      : "  (none)";
  const backlinkSection =
    backlinkLines.length > 0
      ? backlinkLines.join("\n")
      : "  (no backlink data available)";

  return [
    `Domain: ${yourDomain}`,
    `Citation status: cited in ${citedCount} of ${totalQueries} queries.`,
    `Cited by:\n${citedList}`,
    `Not cited by:\n${notCitedList}`,
    `Recent new backlinks (last 30 days):\n${backlinkSection}`,
  ].join("\n\n");
}

export type CitationWhyHypothesis = {
  type:
    | "backlink_authority"
    | "topical_relevance"
    | "content_gap"
    | "brand_awareness"
    | "technical_seo";
  confidence: "high" | "medium" | "low";
  explanation: string;
  action: string;
};

export type CitationWhyResponse = {
  source: "openrouter+dataforseo";
  yourDomain: string;
  prompts: string[];
  cited: boolean;
  citationRate: number;
  citedInQueries: string[];
  recentBacklinksAnalyzed: number;
  overallAssessment: string | null;
  hypotheses: CitationWhyHypothesis[];
  topCausalFactors: string[];
  quickWins: string[];
  dataIssues: string[];
};

export async function buildCitationWhyResponse({
  domain,
  prompts,
  apiKey,
  dataforseoLogin,
  dataforseoPassword,
}: {
  domain: string;
  prompts: string[];
  apiKey: string;
  dataforseoLogin: string;
  dataforseoPassword: string;
}): Promise<CitationWhyResponse> {
  const dataIssues: string[] = [];
  const yourDomain = normalizeDomain(domain);

  // Build citation tasks
  const citationTasks = SEARCH_PLATFORMS.flatMap((platform) =>
    prompts.map((prompt) => ({ platform, prompt })),
  );

  // Parallel: fetch citations + fetch backlinks
  const [citationSettled, backlinksResult] = await Promise.all([
    Promise.allSettled(
      citationTasks.map(({ platform, prompt }) =>
        fetchCitationsFromPlatform(prompt, platform.model, apiKey),
      ),
    ),
    Promise.allSettled([
      fetchDataForSeoBacklinksNewLost({
        domain: yourDomain,
        login: dataforseoLogin,
        password: dataforseoPassword,
        limit: 30,
      }),
    ]),
  ]);

  // Process citation results
  const citedInQueries: string[] = [];
  const notCitedInQueries: string[] = [];

  for (let i = 0; i < citationTasks.length; i++) {
    const { platform, prompt } = citationTasks[i];
    const outcome = citationSettled[i];

    if (outcome.status === "rejected") {
      const msg =
        outcome.reason instanceof Error
          ? outcome.reason.message
          : "Unknown error";
      dataIssues.push(
        `${platform.label} failed for prompt "${prompt}": ${msg}`,
      );
      notCitedInQueries.push(`${platform.label}: ${prompt}`);
      continue;
    }

    if (outcome.value.dataIssue) {
      dataIssues.push(`${platform.label}: ${outcome.value.dataIssue}`);
    }

    const cited = isDomainCited(yourDomain, outcome.value.citations);
    const queryLabel = `${platform.label}: ${prompt}`;
    if (cited) {
      citedInQueries.push(queryLabel);
    } else {
      notCitedInQueries.push(queryLabel);
    }
  }

  const totalQueries = citationTasks.length;
  const citationRate =
    totalQueries > 0
      ? Math.round((citedInQueries.length / totalQueries) * 1000) / 10
      : 0;
  const cited = citedInQueries.length > 0;

  // Process backlinks
  const backlinkOutcome = backlinksResult[0];
  let backlinks: ReturnType<typeof extractBacklinkItems> = [];

  if (backlinkOutcome?.status === "fulfilled") {
    backlinks = extractBacklinkItems(backlinkOutcome.value);
  } else if (backlinkOutcome?.status === "rejected") {
    const msg =
      backlinkOutcome.reason instanceof Error
        ? backlinkOutcome.reason.message
        : "Unknown error";
    dataIssues.push(`Backlinks fetch failed: ${msg}`);
  }

  const backlinkLines = buildBacklinkSummaryLines(backlinks);
  const userMessage = buildUserMessage({
    yourDomain,
    citedInQueries,
    notCitedInQueries,
    totalQueries,
    backlinkLines,
  });

  const analysis = await runGeoAnalysis(userMessage, apiKey);
  if (analysis.dataIssue) {
    dataIssues.push(`GEO analysis: ${analysis.dataIssue}`);
  }

  return {
    source: "openrouter+dataforseo",
    yourDomain,
    prompts,
    cited,
    citationRate,
    citedInQueries,
    recentBacklinksAnalyzed: backlinks.length,
    overallAssessment: analysis.overallAssessment,
    hypotheses: analysis.hypotheses,
    topCausalFactors: analysis.topCausalFactors,
    quickWins: analysis.quickWins,
    dataIssues,
  };
}
