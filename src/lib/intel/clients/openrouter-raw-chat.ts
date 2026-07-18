import { openrouterFetch } from "@/lib/intel/clients/openrouter-chat";

/**
 * Raw OpenAI-compat chat completion over OpenRouter — for callers that want a
 * plain string back rather than the ai-sdk `generateText`/`generateObject`
 * pipeline (e.g. mentions topic clustering, which sends its own hand-rolled
 * prompt + parses JSON out of the response text itself).
 *
 * `cache_control: { type: "ephemeral" }` markers on the system content blocks
 * enable Anthropic prompt caching (routed through OpenRouter). Anthropic
 * silently ignores markers below ~1024 tokens and non-supporting providers
 * ignore the field entirely, so always sending is safe.
 */

const MODEL = "anthropic/claude-sonnet-4";

async function getApiKey(): Promise<string> {
  const { env } = await import("@/env/server");
  if (!env.OPENROUTER_API_KEY)
    throw new Error("OPENROUTER_API_KEY is not configured");
  return env.OPENROUTER_API_KEY;
}

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string | ChatContentBlock[];
}

interface ChatContentBlock {
  type: "text";
  text: string;
  /** Anthropic cache marker — OpenRouter passes it through for Claude models. */
  cache_control?: { type: "ephemeral" };
}

interface LLMResponse {
  id: string;
  choices: Array<{
    message: { role: string; content: string };
    finish_reason: string;
  }>;
  /** OpenRouter surfaces cache token counts in OpenAI-compat form. Anthropic
   *  native field names are kept as fallbacks in case OpenRouter changes. */
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    prompt_tokens_details?: {
      cached_tokens?: number;
      cache_write_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };
}

/**
 * `cacheableContext` — a large shared blob that multiple calls within a
 * 5-minute window will re-send. It's placed FIRST as the cached prefix; the
 * per-call `systemPrompt` follows.
 */
export async function chat(
  systemPrompt: string,
  userMessage: string,
  options?: {
    temperature?: number;
    maxTokens?: number;
    model?: string;
    cacheableContext?: string;
  },
): Promise<string> {
  const key = await getApiKey();

  // Only fan out to structured content blocks when we're actually trying to
  // cache a large context. Short calls send the system as a plain string —
  // safer for any future non-Anthropic route and matches the OpenAI-compat
  // baseline.
  const systemContent: string | ChatContentBlock[] = options?.cacheableContext
    ? [
        {
          type: "text",
          text: options.cacheableContext,
          cache_control: { type: "ephemeral" },
        },
        {
          type: "text",
          text: systemPrompt,
          cache_control: { type: "ephemeral" },
        },
      ]
    : systemPrompt;

  const messages: ChatMessage[] = [
    { role: "system", content: systemContent },
    { role: "user", content: userMessage },
  ];

  const res = await openrouterFetch("llm", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://tecknode.co",
      "X-Title": "Tecknode Intel Engine",
    },
    body: JSON.stringify({
      model: options?.model ?? MODEL,
      messages,
      temperature: options?.temperature ?? 0.3,
      // JSON-array-emitting prompts truncate mid-array at low caps; Sonnet 4
      // supports far more, so default high — callers needing a tight cap
      // pass their own `maxTokens`.
      max_tokens: options?.maxTokens ?? 16384,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`OpenRouter ${res.status}: ${text || res.statusText}`);
  }

  const json = (await res.json()) as LLMResponse;
  const choice = json.choices?.[0];
  const content = choice?.message?.content;
  if (!content) {
    throw new Error("OpenRouter returned empty response");
  }

  // Log cache activity so silent drift (e.g. someone accidentally changes
  // the cached-blob serialization) is visible without digging into the
  // OpenRouter dashboard.
  const details = json.usage?.prompt_tokens_details;
  const cacheRead = details?.cached_tokens ?? details?.cache_read_input_tokens;
  const cacheWrite =
    details?.cache_write_tokens ?? details?.cache_creation_input_tokens;
  if (cacheRead || cacheWrite) {
    console.warn(
      `[intel.raw-chat] prompt cache read=${cacheRead ?? 0} write=${cacheWrite ?? 0} total_input=${json.usage?.prompt_tokens ?? "?"}`,
    );
  }

  // A `length` finish means the model hit the cap and the text (often JSON) is
  // truncated — downstream parsing recovers what it can, but log so a
  // recurring truncation is visible rather than silently degrading quality.
  if (choice.finish_reason === "length") {
    console.warn(
      `[intel.raw-chat] response truncated at max_tokens (model=${options?.model ?? MODEL})`,
    );
  }
  return content;
}
