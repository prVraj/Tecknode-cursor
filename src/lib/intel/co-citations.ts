import { waveTasks } from "@/lib/intel/geo/probe-config";
import { fetchProbeTask, type ProbeTask } from "@/lib/intel/geo/probe-fetch";
import { findUsableProbeResult } from "@/lib/intel/geo/probe-match";
import type { GeoProbeRaw } from "@/lib/intel/geo/probe-types";
import { intelChatCompletion } from "@/lib/intel/llm/openrouter-fetch";
import { logExternalFailure } from "@/utils/log-external";

// ─── Types ────────────────────────────────────────────────────────────────────

export type CoBrand = {
  name: string;
  coOccurrences: number;
  frequency: number;
  platforms: string[];
  prompts: string[];
  isKnownCompetitor: boolean;
  isYourBrand: boolean;
};

export type CoCitationsRawResult = {
  platform: string;
  prompt: string;
  yourBrandMentioned: boolean;
  coBrands: string[];
  dataIssue?: string;
};

export type CoCitationsResponse = {
  source: "openrouter";
  brand: string;
  prompts: string[];
  dataIssues: string[];
  totalResults: number;
  coBrands: CoBrand[];
  summary: {
    totalUniqueCoBrands: number;
    topCoBrand: string | null;
    unknownCompetitors: string[];
  };
  rawResults: CoCitationsRawResult[];
};

// ─── Step 1: Resolve the search wave (probe reuse, else live) ─────────────────

/**
 * Fill each task from the probe's search wave, falling back to a live fetch for
 * any task the probe doesn't cover with a healthy row. Per-task, never
 * all-or-nothing: `frequency` is a ratio over these tasks, so a partially failed
 * probe must not shrink the population and redefine the metric.
 */
async function resolveSearchWave(
  tasks: ProbeTask[],
  apiKey: string,
  probeRaw?: GeoProbeRaw,
): Promise<
  PromiseSettledResult<{ responseText: string; dataIssue?: string }>[]
> {
  return Promise.allSettled(
    tasks.map(async (task) => {
      const reusable = probeRaw
        ? findUsableProbeResult(probeRaw.results, {
            wave: task.wave,
            model: task.platform.model,
            prompt: task.prompt,
          })
        : undefined;

      if (reusable) return { responseText: reusable.responseText };

      return fetchProbeTask(task, apiKey);
    }),
  );
}

// ─── Step 2: Extract brand names from response using GPT-4o-mini ──────────────

const BRAND_EXTRACTION_SYSTEM_PROMPT = `You are an expert at identifying brand names, company names, product names, and tool names in text.

Extract ALL distinct brand/company/product/tool names mentioned in the provided text.
Exclude generic terms, categories, and descriptive words — only extract proper names of specific brands/products.

Return ONLY valid JSON:
{
  "brands": ["BrandA", "BrandB", "ToolC"]
}

If no brands found, return: { "brands": [] }`;

async function extractBrandsWithLlm(
  responseText: string,
  yourBrand: string,
  apiKey: string,
): Promise<{ brands: string[]; dataIssue?: string }> {
  if (!responseText) return { brands: [], dataIssue: "Empty response text" };

  const userMsg = `Extract all brand/company/tool names from this text:\n\n"""${responseText.slice(0, 5000)}"""`;

  const result = await intelChatCompletion({
    apiKey,
    model: "openai/gpt-4o-mini",
    messages: [
      { role: "system", content: BRAND_EXTRACTION_SYSTEM_PROMPT },
      { role: "user", content: userMsg },
    ],
    temperature: 0,
    max_tokens: 512,
    response_format: { type: "json_object" },
    operation: "co-citations.extractBrandsWithLlm",
  });

  if (!result.ok) {
    return {
      brands: [],
      dataIssue: result.httpStatus
        ? `Brand extraction LLM returned HTTP ${result.httpStatus}`
        : result.dataIssue,
    };
  }

  try {
    const parsed = JSON.parse(result.content) as { brands?: unknown };
    const brands = Array.isArray(parsed.brands)
      ? (parsed.brands as unknown[])
          .filter(
            (b): b is string => typeof b === "string" && b.trim().length > 0,
          )
          // exclude the user's own brand (case-insensitive)
          .filter(
            (b) => b.toLowerCase().trim() !== yourBrand.toLowerCase().trim(),
          )
      : [];
    return { brands };
  } catch (err) {
    logExternalFailure("openrouter", "co-citations.extractBrandsWithLlm", err, {
      brand: yourBrand,
    });
    return { brands: [], dataIssue: "Failed to parse brand extraction JSON" };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalise(name: string): string {
  return name.toLowerCase().trim();
}

function buildRawResult(
  task: ProbeTask,
  brand: string,
  searchOutcome: PromiseSettledResult<{
    responseText: string;
    dataIssue?: string;
  }>,
  extractionOutcome: PromiseSettledResult<{
    brands: string[];
    dataIssue?: string;
  }>,
  dataIssues: string[],
): CoCitationsRawResult {
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

  const yourBrandMentioned = responseText
    ? responseText.toLowerCase().includes(brand.toLowerCase())
    : false;

  let coBrands: string[] = [];
  if (extractionOutcome.status === "fulfilled") {
    coBrands = extractionOutcome.value.brands;
    if (extractionOutcome.value.dataIssue) {
      itemIssues.push(extractionOutcome.value.dataIssue);
      dataIssues.push(
        `Brand extraction issue for "${prompt}" on ${platform.label}: ${extractionOutcome.value.dataIssue}`,
      );
    }
  } else {
    const msg =
      extractionOutcome.reason instanceof Error
        ? extractionOutcome.reason.message
        : "Brand extraction failed";
    itemIssues.push(msg);
    dataIssues.push(
      `Brand extraction failed for "${prompt}" on ${platform.label}: ${msg}`,
    );
  }

  const raw: CoCitationsRawResult = {
    platform: platform.label,
    prompt,
    yourBrandMentioned,
    coBrands,
  };
  if (itemIssues.length > 0) raw.dataIssue = itemIssues.join("; ");
  return raw;
}

// ─── Main builder ─────────────────────────────────────────────────────────────

export async function buildCoCitationsResponse({
  brand,
  competitors,
  prompts,
  apiKey,
  probeRaw,
}: {
  brand: string;
  competitors: string[];
  prompts: string[];
  apiKey: string;
  /** Search-wave rows are reused per-task when healthy; the rest are fetched live. */
  probeRaw?: GeoProbeRaw;
}): Promise<CoCitationsResponse> {
  const dataIssues: string[] = [];

  // Fixed by config, never by the probe's contents: `frequency` is a ratio over
  // these tasks, so deriving them from whatever the probe holds would change the
  // denominator day-to-day.
  const tasks = waveTasks("search", prompts);
  const searchResults = await resolveSearchWave(tasks, apiKey, probeRaw);

  // Wave 2: brand extraction for every result (regardless of your brand being mentioned)
  const extractionResults = await Promise.allSettled(
    searchResults.map((outcome) => {
      if (outcome.status === "rejected" || !outcome.value.responseText) {
        return Promise.resolve({
          brands: [] as string[],
          dataIssue: "No response to extract from",
        });
      }
      return extractBrandsWithLlm(outcome.value.responseText, brand, apiKey);
    }),
  );

  const rawResults: CoCitationsRawResult[] = tasks.map((task, i) =>
    buildRawResult(
      task,
      brand,
      searchResults[i] as PromiseSettledResult<{
        responseText: string;
        dataIssue?: string;
      }>,
      extractionResults[i] as PromiseSettledResult<{
        brands: string[];
        dataIssue?: string;
      }>,
      dataIssues,
    ),
  );

  const totalResults = rawResults.length;

  // Build co-brand aggregation map (key = normalised name)
  const coBrandMap = new Map<
    string,
    {
      canonicalName: string;
      count: number;
      platforms: Set<string>;
      prompts: Set<string>;
    }
  >();

  for (const result of rawResults) {
    for (const name of result.coBrands) {
      const key = normalise(name);
      if (!coBrandMap.has(key)) {
        coBrandMap.set(key, {
          canonicalName: name,
          count: 0,
          platforms: new Set(),
          prompts: new Set(),
        });
      }
      const entry = coBrandMap.get(key);
      if (entry) {
        entry.count += 1;
        entry.platforms.add(result.platform);
        entry.prompts.add(result.prompt);
      }
    }
  }

  // Normalised competitors set for O(1) lookup
  const normalisedCompetitors = new Set(competitors.map(normalise));

  // Build sorted CoBrand array
  const coBrands: CoBrand[] = Array.from(coBrandMap.values())
    .map(({ canonicalName, count, platforms, prompts: promptSet }) => ({
      name: canonicalName,
      coOccurrences: count,
      frequency:
        totalResults > 0 ? Math.round((count / totalResults) * 100) : 0,
      platforms: Array.from(platforms),
      prompts: Array.from(promptSet),
      isKnownCompetitor: normalisedCompetitors.has(normalise(canonicalName)),
      isYourBrand: false,
    }))
    .sort((a, b) => b.coOccurrences - a.coOccurrences);

  const topCoBrand = coBrands[0]?.name ?? null;
  const unknownCompetitors = coBrands
    .filter((b) => !b.isKnownCompetitor)
    .slice(0, 5)
    .map((b) => b.name);

  return {
    source: "openrouter",
    brand,
    prompts,
    dataIssues,
    totalResults,
    coBrands,
    summary: {
      totalUniqueCoBrands: coBrands.length,
      topCoBrand,
      unknownCompetitors,
    },
    rawResults,
  };
}
