import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { env } from "@/env/server";

const OPENROUTER_APP_URL = "https://tecknode.co";
const OPENROUTER_APP_NAME = "Tecknode Intel";

/**
 * The intelligence layer uses the platform's OpenRouter key (not per-user
 * keys). Rationale: signal generation is an infrastructure cost —
 * predictable, low-volume, and decoupled from any per-user billing surface.
 */
export function createOpenRouterForKey(apiKey?: string) {
  const key = apiKey?.trim() || env.OPENROUTER_API_KEY?.trim();
  if (!key) {
    throw new Error(
      "OPENROUTER_API_KEY is not configured. Set it to enable the intelligence layer.",
    );
  }
  return createOpenRouter({
    apiKey: key,
    appUrl: OPENROUTER_APP_URL,
    appName: OPENROUTER_APP_NAME,
  });
}

export function getProvider() {
  return createOpenRouterForKey();
}

export const INTEL_MODELS = {
  /** Chat — balances reasoning with cost. Used by the intel-chat actions. */
  chat: "anthropic/claude-sonnet-4.5",
  /** Daily digest narration — cheap, high-throughput. */
  digest: "anthropic/claude-haiku-4.5",
  /** Structured scoring / classification — fast JSON output. */
  scoring: "openai/gpt-4o-mini",
  /** Long-form synthesis and narrative summaries. */
  synthesis: "anthropic/claude-haiku-4.5",
  /** Web-grounded research probes (Perplexity). */
  probe: "perplexity/sonar",
} as const;

export type IntelModelTier = keyof typeof INTEL_MODELS;

export function getChatModel() {
  return getProvider().chat(INTEL_MODELS.chat);
}

export function getDigestModel() {
  return getProvider().chat(INTEL_MODELS.digest);
}

export function getScoringModel() {
  return getProvider().chat(INTEL_MODELS.scoring);
}

export function getSynthesisModel() {
  return getProvider().chat(INTEL_MODELS.synthesis);
}
