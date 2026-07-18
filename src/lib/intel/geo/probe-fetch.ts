import {
  GEO_PROBE_WAVES,
  type GeoProbePlatform,
  type GeoProbeWave,
  waveTasks,
} from "@/lib/intel/geo/probe-config";
import type { GeoProbeRaw, GeoProbeResult } from "@/lib/intel/geo/probe-types";
import { intelChatCompletion } from "@/lib/intel/llm/openrouter-fetch";

/**
 * The one place a GEO probe call is issued.
 *
 * Both the producer (which fills the probe) and every consumer's live-fallback
 * path go through here, so a reused row is by construction identical to what
 * the consumer would have fetched itself. If a consumer fetched through its own
 * bespoke call instead, the two could drift and reuse would silently swap one
 * measurement for another.
 */

export type ProbeTask = {
  wave: GeoProbeWave;
  platform: GeoProbePlatform;
  prompt: string;
};

export type ProbeFetchResult = {
  citations: string[];
  responseText: string;
  usage?: { promptTokens: number; completionTokens: number };
  dataIssue?: string;
};

const URL_REGEX = /https?:\/\/[^\s"',)\]>]+/g;

export function extractUrlsFromText(content: string): string[] {
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

export async function fetchProbeTask(
  task: ProbeTask,
  apiKey: string,
): Promise<ProbeFetchResult> {
  const config = GEO_PROBE_WAVES[task.wave];

  const result = await intelChatCompletion({
    apiKey,
    model: task.platform.model,
    messages: [
      { role: "system", content: config.systemPrompt },
      { role: "user", content: task.prompt },
    ],
    temperature: config.temperature,
    max_tokens: config.maxTokens,
    operation: `geo-probe.${task.wave}`,
  });

  if (!result.ok) {
    return {
      citations: [],
      responseText: "",
      dataIssue: result.httpStatus
        ? `${task.platform.model} returned HTTP ${result.httpStatus}`
        : result.dataIssue,
    };
  }

  const usage =
    result.usage?.promptTokens || result.usage?.completionTokens
      ? {
          promptTokens: result.usage.promptTokens ?? 0,
          completionTokens: result.usage.completionTokens ?? 0,
        }
      : undefined;

  // Prefer the structured citations field (Perplexity returns one); fall back
  // to scraping URLs out of the prose.
  const citations =
    result.citations && result.citations.length > 0
      ? result.citations
      : extractUrlsFromText(result.content);

  return { citations, responseText: result.content, usage };
}

/** Run every (platform × prompt) task in a wave, in parallel. */
export async function runProbeWave(
  wave: GeoProbeWave,
  prompts: string[],
  apiKey: string,
): Promise<
  Array<{ task: ProbeTask; outcome: PromiseSettledResult<ProbeFetchResult> }>
> {
  const tasks = waveTasks(wave, prompts);
  const settled = await Promise.allSettled(
    tasks.map((task) => fetchProbeTask(task, apiKey)),
  );
  return tasks.map((task, i) => ({ task, outcome: settled[i] }));
}

export function toProbeResult(
  task: ProbeTask,
  outcome: PromiseSettledResult<ProbeFetchResult>,
): GeoProbeResult {
  const base = {
    wave: task.wave,
    temperature: GEO_PROBE_WAVES[task.wave].temperature,
    platformId: task.platform.id,
    model: task.platform.model,
    prompt: task.prompt,
  };

  if (outcome.status === "rejected") {
    return {
      ...base,
      responseText: "",
      citations: [],
      dataIssue:
        outcome.reason instanceof Error
          ? outcome.reason.message
          : "Unknown error",
    };
  }

  const { citations, responseText, usage, dataIssue } = outcome.value;
  return {
    ...base,
    responseText,
    citations,
    ...(usage ? { usage } : {}),
    ...(dataIssue ? { dataIssue } : {}),
  };
}

export function buildGeoProbeRaw(
  entries: Array<{
    task: ProbeTask;
    outcome: PromiseSettledResult<ProbeFetchResult>;
  }>,
  ctx: { entityId: string; domain: string; prompts: string[]; runId: string },
): GeoProbeRaw {
  return {
    schemaVersion: 2,
    probedAt: new Date().toISOString(),
    entityId: ctx.entityId,
    domain: ctx.domain,
    prompts: ctx.prompts,
    results: entries.map(({ task, outcome }) => toProbeResult(task, outcome)),
    provenance: {
      producer: "geo_probe",
      runId: ctx.runId,
      sources: ["openrouter/perplexity", "openrouter/openai"],
    },
  };
}
