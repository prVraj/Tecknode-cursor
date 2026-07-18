import { openrouterFetch } from "@/lib/intel/clients/openrouter-chat";
import { logExternalFailure } from "@/utils/log-external";

const SEARCH_SYSTEM_PROMPT =
  "You are a helpful assistant. Answer the user's question thoroughly and accurately.";

const PLATFORMS = [
  { model: "perplexity/sonar-pro", label: "Perplexity Sonar Pro" },
  { model: "perplexity/sonar", label: "Perplexity Sonar" },
  { model: "openai/gpt-4o-mini", label: "ChatGPT (GPT-4o mini)" },
] as const;

// ─── Types ────────────────────────────────────────────────────────────────────

export type FactualErrorType =
  | "wrong_claim"
  | "hallucination"
  | "missing_key_fact"
  | "outdated_info";

export type FactualError = {
  type: FactualErrorType;
  severity: "critical" | "high" | "medium" | "low";
  claim: string;
  correction: string;
};

export type AccuracyLevel =
  | "accurate"
  | "minor_errors"
  | "major_errors"
  | "hallucinated";

export type AuditPlatformResult = {
  platform: string;
  model: string;
  prompt: string;
  responseText: string;
  accuracyLevel: AccuracyLevel;
  errors: FactualError[];
  dataIssue?: string;
};

export type KnownFacts = {
  description?: string;
  founded?: string;
  pricing?: string;
  features?: string[];
  doesNotDo?: string[];
  headquarters?: string;
  customFacts?: string[];
};

export type AccuracyAuditResponse = {
  source: "openrouter";
  brand: string;
  dataIssues: string[];
  summary: {
    totalChecked: number;
    accurate: number;
    withErrors: number;
    criticalErrors: number;
    mostCommonErrorType: FactualErrorType | null;
  };
  results: AuditPlatformResult[];
};

// ─── Step 1: Send prompt to AI search engine ──────────────────────────────────

async function fetchAiResponse(
  prompt: string,
  model: string,
  apiKey: string,
): Promise<{ responseText: string; dataIssue?: string }> {
  let res: Response;
  try {
    res = await openrouterFetch("accuracy-audit", {
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
          { role: "system", content: SEARCH_SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
        temperature: 0.3,
        max_tokens: 1024,
      }),
    });
  } catch (err) {
    logExternalFailure("openrouter", "accuracy-audit.fetchAiResponse", err, {
      model,
    });
    return {
      responseText: "",
      dataIssue: err instanceof Error ? err.message : "Network error",
    };
  }

  if (!res.ok) {
    logExternalFailure(
      "openrouter",
      "accuracy-audit.fetchAiResponse",
      new Error(`HTTP ${res.status}`),
      { model, status: res.status },
    );
    return {
      responseText: "",
      dataIssue: `${model} returned HTTP ${res.status}`,
    };
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const responseText = json.choices?.[0]?.message?.content ?? "";
  return { responseText };
}

// ─── Step 2: Fact-check AI response against known facts ───────────────────────

const FACT_CHECK_SYSTEM_PROMPT = `You are a fact-checking expert specialising in brand accuracy in AI-generated content.

You will receive:
1. Known facts about a brand (provided by the brand owner — treat as ground truth)
2. An AI-generated response about that brand

Your job: identify factual errors, hallucinations, and missing key facts in the AI response compared to the known facts.

Severity guide:
- critical: Completely wrong core claim (wrong product category, wrong pricing model, doesn't do something it clearly does)
- high: Significant factual error about a feature, date, or capability
- medium: Partial inaccuracy or misleading claim
- low: Minor omission or imprecise wording

accuracyLevel:
- "accurate": No meaningful errors found
- "minor_errors": Only low/medium severity issues
- "major_errors": At least one high severity error
- "hallucinated": At least one critical error or invented facts

Return ONLY valid JSON:
{
  "accuracyLevel": "<accurate|minor_errors|major_errors|hallucinated>",
  "errors": [
    {
      "type": "<wrong_claim|hallucination|missing_key_fact|outdated_info>",
      "severity": "<critical|high|medium|low>",
      "claim": "<what the AI said or failed to mention>",
      "correction": "<what it should say according to known facts>"
    }
  ]
}

If the response is accurate, return: { "accuracyLevel": "accurate", "errors": [] }`;

function pushListSection(
  lines: string[],
  items: string[] | undefined,
  header: string,
): void {
  if (!items || items.length === 0) return;
  lines.push(header);
  for (const item of items) lines.push(`  • ${item}`);
}

function serializeKnownFacts(brand: string, knownFacts: KnownFacts): string {
  const lines: string[] = [
    `Brand: ${brand}`,
    "",
    "Known facts (ground truth):",
  ];

  if (knownFacts.description)
    lines.push(`- Description: ${knownFacts.description}`);
  if (knownFacts.founded) lines.push(`- Founded: ${knownFacts.founded}`);
  if (knownFacts.pricing) lines.push(`- Pricing: ${knownFacts.pricing}`);
  if (knownFacts.headquarters)
    lines.push(`- Headquarters: ${knownFacts.headquarters}`);

  pushListSection(lines, knownFacts.features, "- Key features:");
  pushListSection(
    lines,
    knownFacts.doesNotDo,
    "- Does NOT do (common AI confusions):",
  );
  pushListSection(lines, knownFacts.customFacts, "- Additional facts:");

  return lines.join("\n");
}

type LlmFactCheckResult = {
  accuracyLevel: AccuracyLevel;
  errors: FactualError[];
};

async function factCheckWithLlm(
  responseText: string,
  brand: string,
  knownFacts: KnownFacts,
  apiKey: string,
): Promise<{ result: LlmFactCheckResult | null; dataIssue?: string }> {
  if (!responseText) return { result: null, dataIssue: "Empty response text" };

  const factsSection = serializeKnownFacts(brand, knownFacts);

  const userMsg = `${factsSection}

AI response to fact-check:
"""
${responseText.slice(0, 4000)}
"""`;

  let res: Response;
  try {
    res = await openrouterFetch("accuracy-audit", {
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
          { role: "system", content: FACT_CHECK_SYSTEM_PROMPT },
          { role: "user", content: userMsg },
        ],
        temperature: 0,
        max_tokens: 1024,
        response_format: { type: "json_object" },
      }),
    });
  } catch (err) {
    logExternalFailure("openrouter", "accuracy-audit.factCheckWithLlm", err, {
      brand,
    });
    return {
      result: null,
      dataIssue:
        err instanceof Error ? err.message : "Fact-check LLM network error",
    };
  }

  if (!res.ok) {
    logExternalFailure(
      "openrouter",
      "accuracy-audit.factCheckWithLlm",
      new Error(`HTTP ${res.status}`),
      { brand, status: res.status },
    );
    return {
      result: null,
      dataIssue: `Fact-check LLM returned HTTP ${res.status}`,
    };
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const content = json.choices?.[0]?.message?.content ?? "";
  try {
    return { result: JSON.parse(content) as LlmFactCheckResult };
  } catch (err) {
    logExternalFailure("openrouter", "accuracy-audit.factCheckWithLlm", err, {
      brand,
    });
    return { result: null, dataIssue: "Failed to parse fact-check JSON" };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function emptyFactCheckResult(): LlmFactCheckResult {
  return { accuracyLevel: "accurate", errors: [] };
}

function computeSummary(
  results: AuditPlatformResult[],
): AccuracyAuditResponse["summary"] {
  const totalChecked = results.length;
  const accurate = results.filter((r) => r.accuracyLevel === "accurate").length;
  const withErrors = results.filter((r) => r.errors.length > 0).length;

  const allErrors = results.flatMap((r) => r.errors);
  const criticalErrors = allErrors.filter(
    (e) => e.severity === "critical",
  ).length;

  const typeCounts: Record<FactualErrorType, number> = {
    wrong_claim: 0,
    hallucination: 0,
    missing_key_fact: 0,
    outdated_info: 0,
  };

  for (const e of allErrors) {
    typeCounts[e.type] = (typeCounts[e.type] ?? 0) + 1;
  }

  const mostCommonErrorType =
    allErrors.length > 0
      ? (Object.entries(typeCounts).sort(
          (a, b) => b[1] - a[1],
        )[0]?.[0] as FactualErrorType)
      : null;

  return {
    totalChecked,
    accurate,
    withErrors,
    criticalErrors,
    mostCommonErrorType,
  };
}

// ─── Result assembler ─────────────────────────────────────────────────────────

type Task = {
  platform: (typeof PLATFORMS)[number];
  prompt: string;
};

function assembleResult(
  task: Task,
  searchOutcome: PromiseSettledResult<{
    responseText: string;
    dataIssue?: string;
  }>,
  factCheckOutcome: PromiseSettledResult<{
    result: LlmFactCheckResult | null;
    dataIssue?: string;
  }>,
  dataIssues: string[],
): AuditPlatformResult {
  const { platform, prompt } = task;
  const itemIssues: string[] = [];

  let responseText = "";
  if (searchOutcome.status === "fulfilled") {
    responseText = searchOutcome.value.responseText;
    if (searchOutcome.value.dataIssue) {
      itemIssues.push(searchOutcome.value.dataIssue);
      // Lift graceful failures to the top level too, so `hasStoredDataIssues`
      // sees them — otherwise a zeroed score could be diffed into a false delta
      // signal if this capability ever gets a primaryScoreField.
      dataIssues.push(
        `${platform.label} search issue for "${prompt}": ${searchOutcome.value.dataIssue}`,
      );
    }
  } else {
    const msg =
      searchOutcome.reason instanceof Error
        ? searchOutcome.reason.message
        : "Search failed";
    itemIssues.push(msg);
    dataIssues.push(`${platform.label} search failed for "${prompt}": ${msg}`);
  }

  let factCheck = emptyFactCheckResult();
  if (factCheckOutcome.status === "fulfilled") {
    if (factCheckOutcome.value.result) {
      factCheck = factCheckOutcome.value.result;
    }
    if (factCheckOutcome.value.dataIssue) {
      itemIssues.push(factCheckOutcome.value.dataIssue);
      dataIssues.push(
        `Fact-check issue for "${prompt}" on ${platform.label}: ${factCheckOutcome.value.dataIssue}`,
      );
    }
  } else {
    const msg =
      factCheckOutcome.reason instanceof Error
        ? factCheckOutcome.reason.message
        : "Fact-check failed";
    itemIssues.push(msg);
    dataIssues.push(
      `Fact-check failed for "${prompt}" on ${platform.label}: ${msg}`,
    );
  }

  return {
    platform: platform.label,
    model: platform.model,
    prompt,
    responseText,
    accuracyLevel: factCheck.accuracyLevel,
    errors: factCheck.errors,
    ...(itemIssues.length > 0 ? { dataIssue: itemIssues.join("; ") } : {}),
  };
}

// ─── Main builder ─────────────────────────────────────────────────────────────

export async function buildAccuracyAuditResponse({
  brand,
  knownFacts,
  prompts,
  apiKey,
}: {
  brand: string;
  knownFacts: KnownFacts;
  prompts?: string[];
  apiKey: string;
}): Promise<AccuracyAuditResponse> {
  const resolvedPrompts =
    prompts && prompts.length > 0
      ? prompts
      : [
          `what is ${brand}?`,
          `tell me about ${brand}`,
          `what does ${brand} do?`,
        ];

  const dataIssues: string[] = [];

  const tasks = PLATFORMS.flatMap((platform) =>
    resolvedPrompts.map((prompt) => ({ platform, prompt })),
  );

  // Run all (platform × prompt) search calls in parallel
  const searchResults = await Promise.allSettled(
    tasks.map(({ platform, prompt }) =>
      fetchAiResponse(prompt, platform.model, apiKey),
    ),
  );

  // Run all fact-check calls in parallel
  const factCheckResults = await Promise.allSettled(
    searchResults.map((outcome) => {
      if (outcome.status === "rejected" || !outcome.value.responseText) {
        return Promise.resolve({
          result: null as LlmFactCheckResult | null,
          dataIssue: "No response to fact-check",
        });
      }
      return factCheckWithLlm(
        outcome.value.responseText,
        brand,
        knownFacts,
        apiKey,
      );
    }),
  );

  const results: AuditPlatformResult[] = tasks.map((task, i) =>
    assembleResult(
      task,
      searchResults[i] as PromiseSettledResult<{
        responseText: string;
        dataIssue?: string;
      }>,
      factCheckResults[i] as PromiseSettledResult<{
        result: LlmFactCheckResult | null;
        dataIssue?: string;
      }>,
      dataIssues,
    ),
  );

  return {
    source: "openrouter",
    brand,
    dataIssues,
    summary: computeSummary(results),
    results,
  };
}
