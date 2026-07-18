import { intelChatCompletion } from "@/lib/intel/llm/openrouter-fetch";

const ENGINES = [
  {
    id: "perplexity-sonar-pro",
    model: "perplexity/sonar-pro",
    label: "Perplexity Sonar Pro",
    hasWebSearch: true,
    citationType: "live" as const,
  },
  {
    id: "perplexity-sonar",
    model: "perplexity/sonar",
    label: "Perplexity Sonar",
    hasWebSearch: true,
    citationType: "live" as const,
  },
  {
    id: "grok-2",
    model: "x-ai/grok-4.20",
    label: "Grok 4 (xAI)",
    hasWebSearch: true,
    citationType: "live" as const,
  },
  {
    id: "gemini-flash",
    model: "google/gemini-2.0-flash-001",
    label: "Gemini Flash 2.0",
    hasWebSearch: false,
    citationType: "training_data" as const,
  },
  {
    id: "chatgpt-4o",
    model: "openai/gpt-4o",
    label: "ChatGPT (GPT-4o)",
    hasWebSearch: false,
    citationType: "training_data" as const,
  },
  {
    id: "claude-haiku",
    model: "anthropic/claude-haiku-4.5",
    label: "Claude Haiku 4.5 (Anthropic)",
    hasWebSearch: false,
    citationType: "training_data" as const,
  },
  {
    id: "llama-sonar",
    model: "meta-llama/llama-3.1-8b-instruct",
    label: "Llama 3.1 (Meta)",
    hasWebSearch: false,
    citationType: "training_data" as const,
  },
] as const;

const WEB_SEARCH_SYSTEM_PROMPT =
  "You are a helpful assistant. When answering questions, always list your sources as URLs in a 'Citations:' section at the end of your response. Include 3-8 specific URLs directly relevant to the topic.";

const TRAINING_DATA_SYSTEM_PROMPT =
  "You are a helpful assistant. Answer the user's question. If you mention any specific tools, products, companies, or websites, list them clearly in a 'Mentioned:' section at the end with any URLs you know about.";

const URL_REGEX = /https?:\/\/[^\s"',)\]>]+/g;

export type EngineCitationType = "live" | "training_data";

export type EngineResult = {
  engineId: string;
  engineLabel: string;
  model: string;
  hasWebSearch: boolean;
  citationType: EngineCitationType;
  prompt: string;
  yourDomain: {
    domain: string;
    cited: boolean;
    mentioned: boolean;
    citedUrl: string | null;
  };
  competitors: Array<{
    domain: string;
    cited: boolean;
    mentioned: boolean;
    citedUrl: string | null;
  }>;
  allCitations: string[];
  dataIssue?: string;
};

export type EngineCitationsResponse = {
  source: "openrouter";
  yourDomain: string;
  competitors: string[];
  prompts: string[];
  dataIssues: string[];
  disclaimer: string;
  results: EngineResult[];
  engineBreakdown: Array<{
    engineId: string;
    engineLabel: string;
    citationType: EngineCitationType;
    citationRate: number;
    mentionRate: number;
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

async function fetchEngineResponse(
  prompt: string,
  engine: (typeof ENGINES)[number],
  apiKey: string,
): Promise<{ responseText: string; citations: string[]; dataIssue?: string }> {
  const systemPrompt = engine.hasWebSearch
    ? WEB_SEARCH_SYSTEM_PROMPT
    : TRAINING_DATA_SYSTEM_PROMPT;

  const result = await intelChatCompletion({
    apiKey,
    model: engine.model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: prompt },
    ],
    temperature: 0.2,
    max_tokens: 1024,
    operation: "engine-citations.fetchEngineResponse",
  });

  if (!result.ok) {
    return {
      responseText: "",
      citations: [],
      dataIssue: result.httpStatus
        ? `${engine.label} returned HTTP ${result.httpStatus}`
        : result.dataIssue,
    };
  }

  const responseText = result.content;

  // Prefer structured citations field (Perplexity), fall back to URL extraction
  if (result.citations && result.citations.length > 0) {
    return { responseText, citations: result.citations };
  }

  return { responseText, citations: extractUrlsFromText(responseText) };
}

function checkDomainInResults(
  targetDomain: string,
  citations: string[],
  responseText: string,
): { cited: boolean; mentioned: boolean; citedUrl: string | null } {
  const normalizedTarget = normalizeDomain(targetDomain);

  // Check citations for URL-based match
  const matchingUrl =
    citations.find((url) => normalizeDomain(url) === normalizedTarget) ?? null;

  // Check response text for mention — match full domain OR brand name (domain without TLD)
  const lowerText = responseText.toLowerCase();
  const brandName = normalizedTarget.split(".")[0] ?? normalizedTarget;
  const mentioned =
    lowerText.includes(normalizedTarget.toLowerCase()) ||
    (brandName.length > 2 && lowerText.includes(brandName.toLowerCase()));

  return {
    cited: matchingUrl !== null,
    mentioned,
    citedUrl: matchingUrl,
  };
}

export async function buildEngineCitationsResponse({
  domain,
  competitors,
  prompts,
  apiKey,
}: {
  domain: string;
  competitors: string[];
  prompts: string[];
  apiKey: string;
}): Promise<EngineCitationsResponse> {
  const dataIssues: string[] = [];
  const normalizedDomain = normalizeDomain(domain);
  const normalizedCompetitors = competitors.map(normalizeDomain);

  // Tasks = ENGINES × prompts
  const tasks = ENGINES.flatMap((engine) =>
    prompts.map((prompt) => ({ engine, prompt })),
  );

  const settled = await Promise.allSettled(
    tasks.map(({ engine, prompt }) =>
      fetchEngineResponse(prompt, engine, apiKey),
    ),
  );

  const results: EngineResult[] = [];

  for (let i = 0; i < tasks.length; i++) {
    const { engine, prompt } = tasks[i];
    const outcome = settled[i];

    let responseText = "";
    let citations: string[] = [];
    let dataIssue: string | undefined;

    if (outcome.status === "rejected") {
      dataIssue =
        outcome.reason instanceof Error
          ? outcome.reason.message
          : "Unknown error";
      dataIssues.push(
        `${engine.label} failed for prompt "${prompt}": ${dataIssue}`,
      );
    } else {
      responseText = outcome.value.responseText;
      citations = outcome.value.citations;
      if (outcome.value.dataIssue) {
        dataIssue = outcome.value.dataIssue;
        dataIssues.push(`${engine.label}: ${dataIssue}`);
      }
    }

    const yourDomainCheck = checkDomainInResults(
      normalizedDomain,
      citations,
      responseText,
    );

    const competitorChecks = normalizedCompetitors.map((comp) => ({
      domain: comp,
      ...checkDomainInResults(comp, citations, responseText),
    }));

    results.push({
      engineId: engine.id,
      engineLabel: engine.label,
      model: engine.model,
      hasWebSearch: engine.hasWebSearch,
      citationType: engine.citationType,
      prompt,
      yourDomain: {
        domain: normalizedDomain,
        ...yourDomainCheck,
      },
      competitors: competitorChecks,
      allCitations: citations,
      dataIssue,
    });
  }

  // Build engine breakdown
  const engineBreakdown = ENGINES.map((engine) => {
    const engineResults = results.filter((r) => r.engineId === engine.id);
    const total = engineResults.length;

    const citedCount = engineResults.filter((r) => r.yourDomain.cited).length;
    const mentionedCount = engineResults.filter(
      (r) => r.yourDomain.mentioned,
    ).length;

    return {
      engineId: engine.id,
      engineLabel: engine.label,
      citationType: engine.citationType,
      citationRate: total > 0 ? Math.round((citedCount / total) * 100) : 0,
      mentionRate: total > 0 ? Math.round((mentionedCount / total) * 100) : 0,
    };
  });

  const disclaimer =
    "Engines marked citationType='training_data' (ChatGPT, Claude, Gemini, Llama) do not perform live web search — results reflect training data, not real-time citations. Only Perplexity and Grok perform live web search.";

  return {
    source: "openrouter",
    yourDomain: normalizedDomain,
    competitors: normalizedCompetitors,
    prompts,
    dataIssues,
    disclaimer,
    results,
    engineBreakdown,
  };
}
