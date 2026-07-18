const MODEL_LABELS: Record<string, string> = {
  "perplexity/sonar": "Perplexity Sonar",
  "perplexity/sonar-pro": "Perplexity Sonar Pro",
};

const PLATFORM_ID_LABELS: Record<string, string> = {
  "perplexity-sonar": "Perplexity Sonar",
  "perplexity-sonar-pro": "Perplexity Sonar Pro",
};

/** Human-readable platform label for probe raw rows and derived parsers. */
export function resolvePlatformLabel(
  platformId: string,
  model: string,
): string {
  return (
    PLATFORM_ID_LABELS[platformId] ??
    MODEL_LABELS[model] ??
    platformId.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  );
}
