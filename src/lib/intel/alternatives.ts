import {
  type AiMentionResult,
  type AiMentionsResponse,
  buildAiMentionsResponse,
} from "@/lib/intel/ai-mentions";

export type AlternativesResponse = {
  source: "openrouter";
  brand: string;
  competitors: string[];
  dataIssues: string[];
  appearsAsAlternativeTo: string[];
  displacedBy: string[];
  promptResults: AiMentionResult[];
  generatedPrompts: string[];
  summary: {
    alternativeNarrativeScore: number;
    displacementRisk: "high" | "medium" | "low";
  };
};

function generateAlternativePrompts(brand: string): string[] {
  return [
    `alternatives to ${brand}`,
    `best ${brand} alternatives`,
    `${brand} vs competitors`,
    `switched from ${brand}`,
    `replace ${brand} with`,
  ].slice(0, 5);
}

function computeDisplacementRisk(count: number): "high" | "medium" | "low" {
  if (count >= 2) return "high";
  if (count === 1) return "medium";
  return "low";
}

function extractAppearsAsAlternativeTo(
  brand: string,
  competitors: string[],
  results: AiMentionResult[],
): string[] {
  const appeared = new Set<string>();
  for (const result of results) {
    if (!result.yourBrand.mentioned) continue;
    const lowerPrompt = result.prompt.toLowerCase();
    for (const competitor of competitors) {
      if (lowerPrompt.includes(competitor.toLowerCase())) {
        appeared.add(competitor);
      }
    }
  }
  // suppress unused param lint — brand used for context
  void brand;
  return Array.from(appeared);
}

function extractDisplacedBy(
  brand: string,
  results: AiMentionResult[],
): string[] {
  const displaced = new Set<string>();
  const lowerBrand = brand.toLowerCase();
  for (const result of results) {
    if (result.yourBrand.mentioned) continue;
    const promptContainsBrand = result.prompt
      .toLowerCase()
      .includes(lowerBrand);
    if (!promptContainsBrand) continue;
    for (const comp of result.competitors) {
      if (comp.mentionType === "recommended") {
        displaced.add(comp.brand);
      }
    }
  }
  return Array.from(displaced);
}

export async function buildAlternativesResponse({
  brand,
  competitors,
  apiKey,
}: {
  brand: string;
  competitors: string[];
  apiKey: string;
}): Promise<AlternativesResponse> {
  const generatedPrompts = generateAlternativePrompts(brand);

  const mentionsResponse: AiMentionsResponse = await buildAiMentionsResponse({
    brand,
    competitors,
    prompts: generatedPrompts,
    apiKey,
  });

  const results = mentionsResponse.results;
  const dataIssues = [...mentionsResponse.dataIssues];

  const appearsAsAlternativeTo = extractAppearsAsAlternativeTo(
    brand,
    competitors,
    results,
  );
  const displacedBy = extractDisplacedBy(brand, results);

  const mentionedCount = results.filter((r) => r.yourBrand.mentioned).length;
  const alternativeNarrativeScore =
    results.length > 0
      ? Math.round((mentionedCount / results.length) * 100)
      : 0;

  return {
    source: "openrouter",
    brand,
    competitors,
    dataIssues,
    appearsAsAlternativeTo,
    displacedBy,
    promptResults: results,
    generatedPrompts,
    summary: {
      alternativeNarrativeScore,
      displacementRisk: computeDisplacementRisk(displacedBy.length),
    },
  };
}
