import {
  dollarsToMicroUsd,
  recordApiUsage,
} from "@/lib/observability/api-usage";
import { estimateOpenRouterCostUsd } from "@/lib/observability/openrouter-prices";

/**
 * Shared helpers to turn an ai-sdk `usage` object into an `api_usage_events`
 * row for OpenRouter calls. Used by the intel LLM client (digest/scoring/…),
 * the streaming web chat route, and the channel `askIntel` one-shot so all
 * three attribute real token cost to the org via `withApiUsageContext`.
 */

export interface AiSdkUsage {
  totalTokens?: number;
  promptTokens?: number;
  completionTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
}

/** Record a successful OpenRouter call's token usage + estimated cost. */
export async function recordOpenRouterUsage(opts: {
  operation: string;
  modelId: string;
  usage: AiSdkUsage | undefined;
  startedAt: number;
}): Promise<void> {
  const prompt = opts.usage?.promptTokens ?? opts.usage?.inputTokens ?? 0;
  const completion =
    opts.usage?.completionTokens ?? opts.usage?.outputTokens ?? 0;
  const total = opts.usage?.totalTokens ?? prompt + completion;
  const costUsd = estimateOpenRouterCostUsd({
    modelId: opts.modelId,
    promptTokens: prompt,
    completionTokens: completion,
  });
  await recordApiUsage({
    provider: "openrouter",
    operation: opts.operation,
    unitType: "token",
    units: total,
    costMicroUsd: dollarsToMicroUsd(costUsd),
    costSource: costUsd > 0 ? "table" : "unknown",
    status: "success",
    durationMs: Date.now() - opts.startedAt,
  });
}

/** Record a failed OpenRouter call (0 tokens, error status). */
export async function recordOpenRouterError(opts: {
  operation: string;
  err: unknown;
  startedAt: number;
}): Promise<void> {
  const httpStatus =
    opts.err && typeof opts.err === "object" && "status" in opts.err
      ? Number((opts.err as { status?: number }).status) || undefined
      : undefined;
  await recordApiUsage({
    provider: "openrouter",
    operation: opts.operation,
    unitType: "token",
    units: 0,
    costMicroUsd: 0,
    costSource: "unknown",
    status: "error",
    httpStatus,
    durationMs: Date.now() - opts.startedAt,
  });
}
