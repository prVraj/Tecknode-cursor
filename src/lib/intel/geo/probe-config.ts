/**
 * Single source of truth for the daily GEO probe.
 *
 * The probe exists so that one set of LLM calls can serve every `geo_*`
 * capability instead of each one paying for its own. That is only sound when
 * the stored response is byte-for-byte the response the consumer *would have
 * fetched itself* — same model, same system prompt, same temperature. A
 * response produced under a different config is a different measurement, and
 * silently swapping one for the other redefines whatever metric is derived
 * from it.
 *
 * So the probe is split into **waves**. A wave is exactly that config tuple.
 * Consumers declare the wave they need; reuse is only allowed on an exact
 * (wave, model, prompt) match. Adding a capability whose config differs from
 * both waves means adding a third wave — never loosening the match.
 *
 * - `citation`: search-enabled model asked to enumerate source URLs. Feeds
 *   geo_citations and the citation-derived family (sources, keyword matrix,
 *   velocity, authority, traffic estimate).
 * - `search`: plain natural-language answers across the AI surfaces we claim
 *   to measure visibility on. Feeds geo_mentions and geo_co_citations, whose
 *   scores are ratios over the *platform population* — which is why this wave
 *   must keep both platforms even though only one returns citations.
 */

export type GeoProbeWave = "citation" | "search";

export interface GeoProbePlatform {
  id: string;
  model: string;
  label: string;
}

export interface GeoProbeWaveConfig {
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  platforms: readonly GeoProbePlatform[];
}

const CITATION_SYSTEM_PROMPT =
  "You are a helpful assistant. When answering questions, always list your sources as URLs in a 'Citations:' section at the end of your response. Include 3-8 specific URLs directly relevant to the topic.";

const SEARCH_SYSTEM_PROMPT =
  "You are a helpful assistant. Answer the user's question thoroughly and accurately.";

const PERPLEXITY_SONAR: GeoProbePlatform = {
  id: "perplexity-sonar",
  model: "perplexity/sonar",
  label: "Perplexity Sonar",
};

const GPT_4O_MINI: GeoProbePlatform = {
  id: "gpt-4o-mini",
  model: "openai/gpt-4o-mini",
  label: "ChatGPT (GPT-4o mini)",
};

export const GEO_PROBE_WAVES: Record<GeoProbeWave, GeoProbeWaveConfig> = {
  // Only search-enabled platforms return real citation URLs, so the citation
  // wave is Perplexity-only. Widening it would add rows with no citations and
  // deflate every `frequency` denominator downstream.
  citation: {
    systemPrompt: CITATION_SYSTEM_PROMPT,
    temperature: 0.1,
    maxTokens: 1024,
    platforms: [PERPLEXITY_SONAR],
  },
  search: {
    systemPrompt: SEARCH_SYSTEM_PROMPT,
    temperature: 0.3,
    maxTokens: 1024,
    platforms: [PERPLEXITY_SONAR, GPT_4O_MINI],
  },
};

/** Every (platform × prompt) task a wave is expected to cover. */
export function waveTasks(
  wave: GeoProbeWave,
  prompts: string[],
): Array<{ wave: GeoProbeWave; platform: GeoProbePlatform; prompt: string }> {
  return GEO_PROBE_WAVES[wave].platforms.flatMap((platform) =>
    prompts.map((prompt) => ({ wave, platform, prompt })),
  );
}
