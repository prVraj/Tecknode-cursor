import {
  type AiMentionResult,
  type BrandMentionDetail,
  buildAiMentionsResponse,
} from "@/lib/intel/ai-mentions";

export type AiMentionsGeoResult = {
  country: string;
  prompt: string;
  originalPrompt: string;
  yourBrand: BrandMentionDetail;
  competitors: BrandMentionDetail[];
  platform: string;
  model: string;
};

export type AiMentionsGeoResponse = {
  source: "openrouter";
  brand: string;
  basePrompts: string[];
  countries: string[];
  locationNote: string;
  dataIssues: string[];
  results: AiMentionsGeoResult[];
  countryBreakdown: Record<
    string,
    { mentionRate: number; dominantSentiment: string | null }
  >;
};

const LOCATION_NOTE =
  "Location context injected as prompt text. Not true geo-routed AI — results reflect language model training, not region-specific search indexes.";

function generateLocationPrompts(
  basePrompts: string[],
  countries: string[],
): Array<{ prompt: string; originalPrompt: string; country: string }> {
  const generated: Array<{
    prompt: string;
    originalPrompt: string;
    country: string;
  }> = [];
  for (const country of countries) {
    for (const base of basePrompts) {
      generated.push({
        prompt: `${base} in ${country}`,
        originalPrompt: base,
        country,
      });
      if (generated.length >= 5) break;
    }
    if (generated.length >= 5) break;
  }
  return generated;
}

function computeCountryBreakdown(
  countries: string[],
  results: AiMentionsGeoResult[],
): Record<string, { mentionRate: number; dominantSentiment: string | null }> {
  const breakdown: Record<
    string,
    { mentionRate: number; dominantSentiment: string | null }
  > = {};

  for (const country of countries) {
    const countryResults = results.filter((r) => r.country === country);
    if (countryResults.length === 0) {
      breakdown[country] = { mentionRate: 0, dominantSentiment: null };
      continue;
    }

    const mentionedCount = countryResults.filter(
      (r) => r.yourBrand.mentioned,
    ).length;
    const mentionRate = Math.round(
      (mentionedCount / countryResults.length) * 100,
    );

    const sentimentCounts: Record<string, number> = {};
    for (const r of countryResults) {
      const s = r.yourBrand.sentiment;
      if (s !== "not_found") {
        sentimentCounts[s] = (sentimentCounts[s] ?? 0) + 1;
      }
    }

    const dominantSentiment =
      Object.keys(sentimentCounts).length > 0
        ? (Object.entries(sentimentCounts).sort(
            (a, b) => b[1] - a[1],
          )[0]?.[0] ?? null)
        : null;

    breakdown[country] = { mentionRate, dominantSentiment };
  }

  return breakdown;
}

export async function buildAiMentionsGeoResponse({
  brand,
  competitors,
  basePrompts,
  countries,
  apiKey,
}: {
  brand: string;
  competitors: string[];
  basePrompts: string[];
  countries: string[];
  apiKey: string;
}): Promise<AiMentionsGeoResponse> {
  const locationEntries = generateLocationPrompts(basePrompts, countries);
  const generatedPrompts = locationEntries.map((e) => e.prompt);

  const mentionsResponse = await buildAiMentionsResponse({
    brand,
    competitors,
    prompts: generatedPrompts,
    apiKey,
  });

  const dataIssues = [...mentionsResponse.dataIssues];

  const geoResults: AiMentionsGeoResult[] = mentionsResponse.results.map(
    (r: AiMentionResult) => {
      const entry = locationEntries.find((e) => e.prompt === r.prompt);
      return {
        country: entry?.country ?? "unknown",
        prompt: r.prompt,
        originalPrompt: entry?.originalPrompt ?? r.prompt,
        yourBrand: r.yourBrand,
        competitors: r.competitors,
        platform: r.platform,
        model: r.model,
      };
    },
  );

  const countryBreakdown = computeCountryBreakdown(countries, geoResults);

  return {
    source: "openrouter",
    brand,
    basePrompts,
    countries,
    locationNote: LOCATION_NOTE,
    dataIssues,
    results: geoResults,
    countryBreakdown,
  };
}
