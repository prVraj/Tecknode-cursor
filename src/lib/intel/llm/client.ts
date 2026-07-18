import { generateText, Output } from "ai";
import type { z } from "zod";
import { env } from "@/env/server";
import {
  createOpenRouterForKey,
  INTEL_MODELS,
  type IntelModelTier,
} from "@/lib/intel/chat/model";
import {
  promptContextKeys,
  promptRuntimeContext,
} from "@/lib/intel/prompts/resolve";
import {
  recordOpenRouterError,
  recordOpenRouterUsage,
} from "@/lib/observability/openrouter-usage";
import { logExternalFailure } from "@/utils/log-external";

export type IntelLlmUsage = {
  totalTokens?: number;
};

export type IntelLlmResult<T> = {
  data?: T;
  dataIssue?: string;
  usage?: IntelLlmUsage;
};

type IntelLlmBaseArgs = {
  apiKey?: string;
  modelTier: IntelModelTier;
  system: string;
  prompt: string;
  temperature?: number;
  maxTokens?: number;
  /** Prompt identity (from resolveIntelPrompt) — surfaces WHICH prompt ran. */
  promptName?: string;
  promptVersion?: number;
  promptLabel?: string;
};

function resolveApiKey(apiKey?: string): string | undefined {
  const key = apiKey?.trim() || env.OPENROUTER_API_KEY?.trim();
  return key || undefined;
}

function toUsage(
  usage: { totalTokens?: number } | undefined,
): IntelLlmUsage | undefined {
  if (!usage?.totalTokens) return undefined;
  return { totalTokens: usage.totalTokens };
}

function modelForTier(tier: IntelModelTier, apiKey?: string) {
  const key = resolveApiKey(apiKey);
  if (!key) {
    return {
      dataIssue: "OPENROUTER_API_KEY is not configured" as const,
      model: null,
    };
  }
  try {
    const provider = createOpenRouterForKey(key);
    return { model: provider.chat(INTEL_MODELS[tier]), dataIssue: null };
  } catch (err) {
    logExternalFailure("openrouter", "llm-client.modelForTier", err);
    return {
      dataIssue:
        err instanceof Error
          ? err.message
          : "Failed to initialize OpenRouter provider",
      model: null,
    };
  }
}

export async function intelGenerateObject<T>({
  apiKey,
  modelTier,
  system,
  prompt,
  schema,
  temperature,
  maxTokens,
  promptName,
  promptVersion,
  promptLabel,
}: IntelLlmBaseArgs & {
  schema: z.ZodType<T>;
}): Promise<IntelLlmResult<T>> {
  const { model, dataIssue } = modelForTier(modelTier, apiKey);
  if (!model) {
    return { dataIssue: dataIssue ?? "OpenRouter model unavailable" };
  }

  const modelId = INTEL_MODELS[modelTier];
  const startedAt = Date.now();
  const runtimeContext = promptName
    ? promptRuntimeContext({
        promptName,
        promptVersion,
        promptLabel: promptLabel ?? "unknown",
      })
    : undefined;
  try {
    const { output, usage } = await generateText({
      model,
      instructions: system,
      prompt,
      output: Output.object({ schema }),
      temperature,
      maxOutputTokens: maxTokens,
      runtimeContext,
      telemetry: {
        functionId: `intel.${modelTier}.object`,
        ...(runtimeContext ? { includeRuntimeContext: promptContextKeys } : {}),
      },
    });
    await recordOpenRouterUsage({
      operation: `intelGenerateObject:${modelId}`,
      modelId,
      usage,
      startedAt,
    });
    return { data: output, usage: toUsage(usage) };
  } catch (err) {
    await recordOpenRouterError({
      operation: `intelGenerateObject:${modelId}`,
      err,
      startedAt,
    });
    logExternalFailure("openrouter", "llm-client.intelGenerateObject", err);
    return {
      dataIssue:
        err instanceof Error ? err.message : "LLM structured generation failed",
    };
  }
}

export async function intelGenerateText({
  apiKey,
  modelTier,
  system,
  prompt,
  temperature,
  maxTokens,
  promptName,
  promptVersion,
  promptLabel,
}: IntelLlmBaseArgs): Promise<IntelLlmResult<string>> {
  const { model, dataIssue } = modelForTier(modelTier, apiKey);
  if (!model) {
    return { dataIssue: dataIssue ?? "OpenRouter model unavailable" };
  }

  const modelId = INTEL_MODELS[modelTier];
  const startedAt = Date.now();
  const runtimeContext = promptName
    ? promptRuntimeContext({
        promptName,
        promptVersion,
        promptLabel: promptLabel ?? "unknown",
      })
    : undefined;
  try {
    const { text, usage } = await generateText({
      model,
      instructions: system,
      prompt,
      temperature,
      maxOutputTokens: maxTokens,
      runtimeContext,
      telemetry: {
        functionId: `intel.${modelTier}`,
        ...(runtimeContext ? { includeRuntimeContext: promptContextKeys } : {}),
      },
    });
    await recordOpenRouterUsage({
      operation: `intelGenerateText:${modelId}`,
      modelId,
      usage,
      startedAt,
    });
    return { data: text, usage: toUsage(usage) };
  } catch (err) {
    await recordOpenRouterError({
      operation: `intelGenerateText:${modelId}`,
      err,
      startedAt,
    });
    logExternalFailure("openrouter", "llm-client.intelGenerateText", err);
    return {
      dataIssue:
        err instanceof Error ? err.message : "LLM text generation failed",
    };
  }
}
