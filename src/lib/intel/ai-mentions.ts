import { waveTasks } from "@/lib/intel/geo/probe-config";
import { fetchProbeTask, type ProbeTask } from "@/lib/intel/geo/probe-fetch";
import { findUsableProbeResult } from "@/lib/intel/geo/probe-match";
import type { GeoProbeRaw } from "@/lib/intel/geo/probe-types";
import { intelChatCompletion } from "@/lib/intel/llm/openrouter-fetch";
import { logExternalFailure } from "@/utils/log-external";

export type MentionPosition = "early" | "middle" | "late" | "not_found";
export type MentionSentiment =
  | "positive"
  | "neutral"
  | "negative"
  | "not_found";
export type MentionType =
  | "recommended"
  | "mentioned"
  | "compared"
  | "not_found";

export type BrandMentionDetail = {
  brand: string;
  mentioned: boolean;
  mentionCount: number;
  firstMentionPosition: MentionPosition;
  listRank: number | null;
  mentionType: MentionType;
  sentiment: MentionSentiment;
  context: string | null;
};

export type AiMentionResult = {
  platform: string;
  model: string;
  prompt: string;
  responseText: string;
  yourBrand: BrandMentionDetail;
  competitors: BrandMentionDetail[];
  dataIssue?: string;
};

export type AiMentionsResponse = {
  source: "openrouter";
  brand: string;
  competitors: string[];
  prompts: string[];
  dataIssues: string[];
  results: AiMentionResult[];
  summary: {
    totalQueries: number;
    mentionedIn: number;
    mentionRate: number;
    avgPosition: MentionPosition | null;
    dominantSentiment: MentionSentiment | null;
  };
};

// ─── Step 2: Analyse response for brand mentions ──────────────────────────────

const ANALYSIS_SYSTEM_PROMPT = `You are analyzing an AI search engine response to detect brand mentions, sentiment, recommendation strength, and list position.

For each brand provided, determine:
- mentioned: Is the brand name present in the response? (case-insensitive)
- mentionCount: Total number of times the brand name appears (0 if not mentioned)
- firstMentionPosition: Where the first mention appears — "early" (first third of text), "middle" (middle third), "late" (final third), "not_found"
- listRank: If the response contains a numbered or bulleted list of tools/products, what rank/position is this brand in that list? (1 = first listed, 2 = second, etc. null if not in a list or not mentioned)
- mentionType: How is the brand mentioned? — "recommended" (actively suggested as a top choice, "you should use X", "X is best for Y"), "mentioned" (referenced factually or in passing without strong endorsement), "compared" (mentioned as part of a comparison without clear recommendation), "not_found" (not mentioned)
- sentiment: Tone around the brand — "positive" (praised, leading, top choice), "neutral" (factual, no evaluation), "negative" (criticized, not recommended, outperformed), "not_found"
- context: The sentence or phrase containing the first mention (null if not mentioned)

Return ONLY valid JSON:
{
  "BrandName": {
    "mentioned": true,
    "mentionCount": 2,
    "firstMentionPosition": "early",
    "listRank": 1,
    "mentionType": "recommended",
    "sentiment": "positive",
    "context": "BrandName is one of the top recommended tools for..."
  }
}`;

type LlmMentionMap = Record<
  string,
  {
    mentioned: boolean;
    mentionCount: number;
    firstMentionPosition: MentionPosition;
    listRank: number | null;
    mentionType: MentionType;
    sentiment: MentionSentiment;
    context: string | null;
  }
>;

async function analyseMentions(
  responseText: string,
  brands: string[],
  apiKey: string,
): Promise<{ result: LlmMentionMap | null; dataIssue?: string }> {
  if (!responseText) return { result: null, dataIssue: "Empty response text" };

  const userMsg = `Brands to track: ${brands.map((b) => `"${b}"`).join(", ")}

AI response to analyse:
"""
${responseText.slice(0, 6000)}
"""`;

  const result = await intelChatCompletion({
    apiKey,
    model: "openai/gpt-4o-mini",
    messages: [
      { role: "system", content: ANALYSIS_SYSTEM_PROMPT },
      { role: "user", content: userMsg },
    ],
    temperature: 0,
    max_tokens: 1024,
    response_format: { type: "json_object" },
    operation: "ai-mentions.analyseMentions",
  });

  if (!result.ok) {
    return {
      result: null,
      dataIssue: result.httpStatus
        ? `Analysis LLM returned HTTP ${result.httpStatus}`
        : result.dataIssue,
    };
  }

  try {
    return { result: JSON.parse(result.content) as LlmMentionMap };
  } catch (err) {
    logExternalFailure("openrouter", "ai-mentions.analyseMentions", err);
    return { result: null, dataIssue: "Failed to parse analysis JSON" };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function emptyMentionDetail(brand: string): BrandMentionDetail {
  return {
    brand,
    mentioned: false,
    mentionCount: 0,
    firstMentionPosition: "not_found",
    listRank: null,
    mentionType: "not_found",
    sentiment: "not_found",
    context: null,
  };
}

function mentionDetailFromMap(
  brand: string,
  map: LlmMentionMap | null,
): BrandMentionDetail {
  if (!map) return emptyMentionDetail(brand);
  const data = map[brand] ?? map[brand.toLowerCase()];
  if (!data) return emptyMentionDetail(brand);
  return {
    brand,
    mentioned: data.mentioned,
    mentionCount: data.mentionCount,
    firstMentionPosition: data.firstMentionPosition,
    listRank: data.listRank ?? null,
    mentionType: data.mentionType ?? "not_found",
    sentiment: data.sentiment,
    context: data.context,
  };
}

function computeSummary(
  brand: string,
  results: AiMentionResult[],
): AiMentionsResponse["summary"] {
  const totalQueries = results.length;
  const mentionedIn = results.filter((r) => r.yourBrand.mentioned).length;
  const mentionRate =
    totalQueries > 0 ? Math.round((mentionedIn / totalQueries) * 100) : 0;

  const positions = results
    .map((r) => r.yourBrand.firstMentionPosition)
    .filter((p): p is "early" | "middle" | "late" => p !== "not_found");

  const positionCounts: Record<string, number> = {
    early: 0,
    middle: 0,
    late: 0,
  };
  for (const p of positions) positionCounts[p] = (positionCounts[p] ?? 0) + 1;
  const avgPosition =
    positions.length > 0
      ? (Object.entries(positionCounts).sort(
          (a, b) => b[1] - a[1],
        )[0]?.[0] as MentionPosition)
      : null;

  const sentiments = results
    .map((r) => r.yourBrand.sentiment)
    .filter((s): s is "positive" | "neutral" | "negative" => s !== "not_found");

  const sentimentCounts: Record<string, number> = {
    positive: 0,
    neutral: 0,
    negative: 0,
  };
  for (const s of sentiments)
    sentimentCounts[s] = (sentimentCounts[s] ?? 0) + 1;
  const dominantSentiment =
    sentiments.length > 0
      ? (Object.entries(sentimentCounts).sort(
          (a, b) => b[1] - a[1],
        )[0]?.[0] as MentionSentiment)
      : null;

  return {
    totalQueries,
    mentionedIn,
    mentionRate,
    avgPosition,
    dominantSentiment,
  };
}

type SearchWaveResult = { responseText: string; dataIssue?: string };

/**
 * Fill each task from the probe's search wave, falling back to a live fetch for
 * any task the probe doesn't cover with a healthy row.
 *
 * Resolution is per-task, never all-or-nothing: a probe that failed on one
 * platform must not zero out the others, and a probe missing a platform
 * entirely must not silently shrink the measured population — `mentionRate` is
 * a ratio over these tasks, so dropping one would redefine the metric rather
 * than just lose a data point.
 */
async function resolveSearchWave(
  tasks: ProbeTask[],
  apiKey: string,
  probeRaw?: GeoProbeRaw,
): Promise<PromiseSettledResult<SearchWaveResult>[]> {
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

// ─── Main builder ─────────────────────────────────────────────────────────────

export async function buildAiMentionsResponse({
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
  probeRaw?: GeoProbeRaw;
}): Promise<AiMentionsResponse> {
  const dataIssues: string[] = [];
  const allBrands = [brand, ...competitors];

  // The task set is fixed by config, never by what the probe happens to hold.
  // `mentionRate` is mentions/tasks, so letting the probe's contents decide the
  // platform list would silently change the metric's denominator.
  const tasks = waveTasks("search", prompts);

  const searchResults = await resolveSearchWave(tasks, apiKey, probeRaw);

  // Run all analysis calls in parallel (each feeds on its search result)
  const analysisResults = await Promise.allSettled(
    searchResults.map((outcome, i) => {
      if (outcome.status === "rejected" || !outcome.value.responseText) {
        return Promise.resolve({
          result: null as LlmMentionMap | null,
          dataIssue: "No response to analyse",
        });
      }
      return analyseMentions(outcome.value.responseText, allBrands, apiKey);
    }),
  );

  const results: AiMentionResult[] = tasks.map(({ platform, prompt }, i) => {
    const searchOutcome = searchResults[i];
    const analysisOutcome = analysisResults[i];

    const itemIssues: string[] = [];

    let responseText = "";
    if (searchOutcome.status === "fulfilled") {
      responseText = searchOutcome.value.responseText;
      if (searchOutcome.value.dataIssue) {
        itemIssues.push(searchOutcome.value.dataIssue);
        // Also surface graceful (non-throwing) failures at the top level, so
        // `hasStoredDataIssues` sees them and the runner suppresses the zeroed
        // score instead of firing a bogus "-100% mentions" delta signal.
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
      dataIssues.push(
        `${platform.label} search failed for "${prompt}": ${msg}`,
      );
    }

    let mentionMap: LlmMentionMap | null = null;
    if (analysisOutcome.status === "fulfilled") {
      mentionMap = analysisOutcome.value.result;
      if (analysisOutcome.value.dataIssue) {
        itemIssues.push(analysisOutcome.value.dataIssue);
        // A parse/analysis failure zeroes every mentionCount; propagate it to
        // the top-level dataIssues so the runner's guard doesn't diff the zero
        // against a healthy prior and fabricate a "-100% collapse" alert.
        dataIssues.push(
          `Analysis issue for "${prompt}" on ${platform.label}: ${analysisOutcome.value.dataIssue}`,
        );
      }
    } else {
      const msg =
        analysisOutcome.reason instanceof Error
          ? analysisOutcome.reason.message
          : "Analysis failed";
      itemIssues.push(msg);
      dataIssues.push(
        `Analysis failed for "${prompt}" on ${platform.label}: ${msg}`,
      );
    }

    return {
      platform: platform.label,
      model: platform.model,
      prompt,
      responseText,
      yourBrand: mentionDetailFromMap(brand, mentionMap),
      competitors: competitors.map((c) => mentionDetailFromMap(c, mentionMap)),
      ...(itemIssues.length > 0 ? { dataIssue: itemIssues.join("; ") } : {}),
    };
  });

  return {
    source: "openrouter",
    brand,
    competitors,
    prompts,
    dataIssues,
    results,
    summary: computeSummary(brand, results),
  };
}
