import {
  dollarsToMicroUsd,
  recordApiUsage,
} from "@/lib/observability/api-usage";
import { estimateOpenRouterCostUsd } from "@/lib/observability/openrouter-prices";
import { logExternalFailure } from "@/utils/log-external";

const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";

export type IntelChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type IntelChatCompletionArgs = {
  apiKey: string;
  model: string;
  messages: IntelChatMessage[];
  temperature?: number;
  max_tokens?: number;
  response_format?: { type: "json_object" };
  /** Overrides the default `intelChatCompletion:<model>` operation label. */
  operation?: string;
};

export type IntelChatCompletionUsage = {
  totalTokens?: number;
  promptTokens?: number;
  completionTokens?: number;
};

export type IntelChatCompletionResult =
  | {
      ok: true;
      content: string;
      citations?: string[];
      usage?: IntelChatCompletionUsage;
    }
  | {
      ok: false;
      dataIssue: string;
      httpStatus?: number;
    };

type OpenRouterUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
};

type OpenRouterChatResponse = {
  citations?: string[];
  usage?: OpenRouterUsage;
  choices?: Array<{ message?: { content?: string } }>;
};

function parseUsage(
  usage: OpenRouterUsage | undefined,
): IntelChatCompletionUsage | undefined {
  if (!usage) return undefined;
  const promptTokens = usage.prompt_tokens ?? 0;
  const completionTokens = usage.completion_tokens ?? 0;
  const sum = promptTokens + completionTokens;
  const totalTokens = usage.total_tokens ?? (sum > 0 ? sum : undefined);
  if (!(totalTokens || promptTokens || completionTokens)) {
    return undefined;
  }
  return {
    totalTokens,
    promptTokens: promptTokens || undefined,
    completionTokens: completionTokens || undefined,
  };
}

async function recordOpenRouterUsage(opts: {
  operation: string;
  modelId: string;
  usage: IntelChatCompletionUsage | undefined;
  startedAt: number;
}) {
  const prompt = opts.usage?.promptTokens ?? 0;
  const completion = opts.usage?.completionTokens ?? 0;
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

async function recordOpenRouterError(opts: {
  operation: string;
  httpStatus?: number;
  startedAt: number;
}) {
  await recordApiUsage({
    provider: "openrouter",
    operation: opts.operation,
    unitType: "token",
    units: 0,
    costMicroUsd: 0,
    costSource: "unknown",
    status: "error",
    httpStatus: opts.httpStatus,
    durationMs: Date.now() - opts.startedAt,
  });
}

/**
 * Thin OpenRouter chat/completions wrapper with token metering. Inherits
 * `capabilityKey` / org context from ambient `withApiUsageContext`.
 */
export async function intelChatCompletion(
  args: IntelChatCompletionArgs,
): Promise<IntelChatCompletionResult> {
  const operation = args.operation ?? `intelChatCompletion:${args.model}`;
  const startedAt = Date.now();

  let res: Response;
  try {
    res = await fetch(OPENROUTER_CHAT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${args.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://runagents.co",
        "X-Title": "RunAgents Intel",
      },
      body: JSON.stringify({
        model: args.model,
        messages: args.messages,
        ...(args.temperature !== undefined
          ? { temperature: args.temperature }
          : {}),
        ...(args.max_tokens !== undefined
          ? { max_tokens: args.max_tokens }
          : {}),
        ...(args.response_format
          ? { response_format: args.response_format }
          : {}),
      }),
    });
  } catch (err) {
    logExternalFailure(
      "openrouter",
      "openrouter-fetch.intelChatCompletion",
      err,
      {
        model: args.model,
      },
    );
    await recordOpenRouterError({ operation, startedAt });
    return {
      ok: false,
      dataIssue: err instanceof Error ? err.message : "Network error",
    };
  }

  if (!res.ok) {
    logExternalFailure(
      "openrouter",
      "openrouter-fetch.intelChatCompletion",
      new Error(`HTTP ${res.status}`),
      { model: args.model, status: res.status },
    );
    await recordOpenRouterError({
      operation,
      httpStatus: res.status,
      startedAt,
    });
    return {
      ok: false,
      dataIssue: `OpenRouter returned HTTP ${res.status}`,
      httpStatus: res.status,
    };
  }

  let json: OpenRouterChatResponse;
  try {
    json = (await res.json()) as OpenRouterChatResponse;
  } catch (err) {
    logExternalFailure(
      "openrouter",
      "openrouter-fetch.intelChatCompletion",
      err,
      {
        model: args.model,
      },
    );
    await recordOpenRouterError({ operation, startedAt });
    return {
      ok: false,
      dataIssue: "Failed to parse OpenRouter response JSON",
    };
  }

  const usage = parseUsage(json.usage);
  await recordOpenRouterUsage({
    operation,
    modelId: args.model,
    usage,
    startedAt,
  });

  const content = json.choices?.[0]?.message?.content ?? "";
  const citations =
    Array.isArray(json.citations) && json.citations.length > 0
      ? json.citations
      : undefined;

  return {
    ok: true,
    content,
    citations,
    usage,
  };
}
