import {
  extractDataForSeoSerpData,
  fetchDataForSeoSerp,
} from "@/lib/dataforseo";
import { openrouterFetch } from "@/lib/intel/clients/openrouter-chat";
import { logExternalFailure } from "@/utils/log-external";

const CLASSIFY_SYSTEM_PROMPT =
  'You are an AI search optimization expert. Classify prompts by their likelihood of appearing in AI search engine queries. Return ONLY valid JSON: { "results": [{ "prompt": "...", "aiLikely": true|false, "conversationalScore": 0-100 }] }';

export type DiscoveredPrompt = {
  prompt: string;
  source: "paa" | "related_search" | "paa_expansion";
  aiLikely: boolean;
  conversationalScore: number;
  seedKeyword: string;
};

export type PromptResearchResponse = {
  source: "dataforseo+openrouter";
  seedKeyword: string;
  location: string;
  dataIssues: string[];
  limitation: string;
  prompts: DiscoveredPrompt[];
  aiLikelyCount: number;
  topAiPrompts: string[];
};

const LIMITATION =
  "Prompts discovered via Google PAA/related searches as proxy. DataForSEO has no dedicated AI prompt discovery endpoint.";

function fallbackClassify(prompt: string): {
  aiLikely: boolean;
  conversationalScore: number;
} {
  const lower = prompt.toLowerCase();
  const aiLikely =
    lower.startsWith("how") ||
    lower.startsWith("what") ||
    lower.startsWith("why") ||
    lower.startsWith("best");
  return { aiLikely, conversationalScore: 50 };
}

async function classifyPromptsWithLlm(
  prompts: string[],
  apiKey: string,
): Promise<Map<string, { aiLikely: boolean; conversationalScore: number }>> {
  const result = new Map<
    string,
    { aiLikely: boolean; conversationalScore: number }
  >();

  if (prompts.length === 0) return result;

  let res: Response;
  try {
    res = await openrouterFetch("prompt-research", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://runagents.co",
        "X-Title": "RunAgents Intel",
      },
      body: JSON.stringify({
        model: "openai/gpt-4o-mini",
        messages: [
          { role: "system", content: CLASSIFY_SYSTEM_PROMPT },
          { role: "user", content: prompts.map((p) => `- ${p}`).join("\n") },
        ],
        temperature: 0,
        max_tokens: 2048,
        response_format: { type: "json_object" },
      }),
    });
  } catch (err) {
    logExternalFailure(
      "openrouter",
      "prompt-research.classifyPromptsWithLlm",
      err,
    );
    return result;
  }

  if (!res.ok) {
    logExternalFailure(
      "openrouter",
      "prompt-research.classifyPromptsWithLlm",
      new Error(`HTTP ${res.status}`),
      { status: res.status },
    );
    return result;
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = json.choices?.[0]?.message?.content ?? "";

  try {
    const parsed = JSON.parse(content) as {
      results?: Array<{
        prompt: string;
        aiLikely: boolean;
        conversationalScore: number;
      }>;
    };
    for (const item of parsed.results ?? []) {
      result.set(item.prompt, {
        aiLikely: item.aiLikely,
        conversationalScore: item.conversationalScore,
      });
    }
  } catch (err) {
    logExternalFailure(
      "openrouter",
      "prompt-research.classifyPromptsWithLlm",
      err,
    );
    // fallback used below
  }

  return result;
}

export async function buildPromptResearchResponse({
  keyword,
  location,
  limit,
  login,
  password,
  apiKey,
}: {
  keyword: string;
  location?: string;
  limit: number;
  login: string;
  password: string;
  apiKey?: string;
}): Promise<PromptResearchResponse> {
  const dataIssues: string[] = [];
  const collected: Array<{
    prompt: string;
    source: DiscoveredPrompt["source"];
  }> = [];
  const seen = new Set<string>();

  function addPrompt(prompt: string, source: DiscoveredPrompt["source"]) {
    const key = prompt.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      collected.push({ prompt, source });
    }
  }

  // Seed SERP fetch
  let seedPaa: string[] = [];
  try {
    const seedResult = await fetchDataForSeoSerp({
      keyword,
      location,
      login,
      password,
    });
    const serpData = extractDataForSeoSerpData(seedResult);

    for (const item of serpData.peopleAlsoAsk) {
      if (item.question) {
        addPrompt(item.question, "paa");
        seedPaa.push(item.question);
      }
    }
    for (const item of serpData.relatedSearches) {
      if (item.query) addPrompt(item.query, "related_search");
    }
  } catch (err) {
    const msg =
      err instanceof Error ? err.message : "DataForSEO SERP fetch failed";
    dataIssues.push(msg);
  }

  // PAA expansion — top 3 PAA questions
  seedPaa = seedPaa.slice(0, 3);
  if (seedPaa.length > 0) {
    const expansionResults = await Promise.allSettled(
      seedPaa.map((q) =>
        fetchDataForSeoSerp({ keyword: q, location, login, password }),
      ),
    );
    for (let i = 0; i < expansionResults.length; i++) {
      const result = expansionResults[i];
      if (result?.status === "fulfilled") {
        const serpData = extractDataForSeoSerpData(result.value);
        for (const item of serpData.peopleAlsoAsk) {
          if (item.question) addPrompt(item.question, "paa_expansion");
        }
      } else if (result?.status === "rejected") {
        dataIssues.push(`PAA expansion failed for "${seedPaa[i]}"`);
      }
    }
  }

  // Classify prompts
  const promptTexts = collected.map((c) => c.prompt);
  let classifyMap = new Map<
    string,
    { aiLikely: boolean; conversationalScore: number }
  >();
  if (apiKey) {
    classifyMap = await classifyPromptsWithLlm(promptTexts, apiKey);
  }

  const discoveredPrompts: DiscoveredPrompt[] = collected.map((c) => {
    const classification =
      classifyMap.get(c.prompt) ?? fallbackClassify(c.prompt);
    return {
      prompt: c.prompt,
      source: c.source,
      aiLikely: classification.aiLikely,
      conversationalScore: classification.conversationalScore,
      seedKeyword: keyword,
    };
  });

  // Sort by conversationalScore desc then apply limit
  discoveredPrompts.sort(
    (a, b) => b.conversationalScore - a.conversationalScore,
  );
  const limited = discoveredPrompts.slice(0, limit);

  const aiLikelyCount = limited.filter((p) => p.aiLikely).length;
  const topAiPrompts = limited
    .filter((p) => p.aiLikely)
    .slice(0, 5)
    .map((p) => p.prompt);

  return {
    source: "dataforseo+openrouter",
    seedKeyword: keyword,
    location: location ?? "United States",
    dataIssues,
    limitation: LIMITATION,
    prompts: limited,
    aiLikelyCount,
    topAiPrompts,
  };
}
