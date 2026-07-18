/**
 * Per-million-token prices in USD for OpenRouter models we currently use.
 * Kept as a static table for speed; reconciliation against OpenRouter's billing
 * API is a phase-3 follow-up. Drift risk is real — refresh quarterly or when a
 * new model is added to INTEL_MODELS.
 *
 * Source: https://openrouter.ai/<modelId> "Pricing" panel as of 2026-06-14.
 */
const OPENROUTER_MODEL_PRICES_USD_PER_MTOK: Record<
  string,
  { prompt: number; completion: number }
> = {
  // GPT family
  "openai/gpt-5": { prompt: 5.0, completion: 15.0 },
  "openai/gpt-5-mini": { prompt: 0.25, completion: 2.0 },
  "openai/gpt-4o": { prompt: 2.5, completion: 10.0 },
  "openai/gpt-4o-mini": { prompt: 0.15, completion: 0.6 },
  "openai/gpt-4.1": { prompt: 2.0, completion: 8.0 },
  "openai/gpt-4.1-mini": { prompt: 0.4, completion: 1.6 },

  // Anthropic
  "anthropic/claude-opus-4.7": { prompt: 15.0, completion: 75.0 },
  "anthropic/claude-sonnet-4.6": { prompt: 3.0, completion: 15.0 },
  "anthropic/claude-sonnet-4.5": { prompt: 3.0, completion: 15.0 },
  "anthropic/claude-haiku-4.5": { prompt: 1.0, completion: 5.0 },

  // Perplexity (used for `geo_*` research)
  "perplexity/sonar": { prompt: 1.0, completion: 1.0 },
  "perplexity/sonar-pro": { prompt: 3.0, completion: 15.0 },

  // Google
  "google/gemini-2.5-flash": { prompt: 0.075, completion: 0.3 },
  "google/gemini-2.5-pro": { prompt: 1.25, completion: 5.0 },
  "google/gemini-2.0-flash-001": { prompt: 0.1, completion: 0.4 },

  // xAI (Grok)
  "x-ai/grok-4.20": { prompt: 2.0, completion: 10.0 },

  // Meta
  "meta-llama/llama-3.1-8b-instruct": { prompt: 0.02, completion: 0.03 },
};

/**
 * Best-effort USD price for a completed OpenRouter call. Returns 0 when the
 * model isn't in the table (caller logs a warning) so the event still records
 * with `costSource: "table"` and we can spot price-table drift in the dashboard.
 */
export function estimateOpenRouterCostUsd(opts: {
  modelId: string;
  promptTokens?: number;
  completionTokens?: number;
}): number {
  const price = OPENROUTER_MODEL_PRICES_USD_PER_MTOK[opts.modelId];
  if (!price) return 0;
  const prompt = ((opts.promptTokens ?? 0) / 1_000_000) * price.prompt;
  const completion =
    ((opts.completionTokens ?? 0) / 1_000_000) * price.completion;
  return prompt + completion;
}
