import {
  extractDataForSeoSerpData,
  fetchDataForSeoSerp,
} from "@/lib/dataforseo";
import { openrouterFetch } from "@/lib/intel/clients/openrouter-chat";
import { buildCompetitorVisibilityResponse } from "@/lib/intel/competitor-visibility";
import { logExternalFailure } from "@/utils/log-external";

const GAP_SYSTEM_PROMPT =
  'You are a GEO (Generative Engine Optimization) expert. Given content gaps where competitors appear in AI citations but a brand does not, rank each gap by priority and suggest a content angle. Return ONLY valid JSON array: [{"prompt": "...", "priority": "critical|high|medium|low", "suggestedContentAngle": "..."}]';

export type ContentGap = {
  prompt: string;
  competitorsCited: string[];
  competitorCitationCount: number;
  relatedQuestions: string[];
  priority: "critical" | "high" | "medium" | "low";
  suggestedContentAngle: string;
};

export type ContentGapResponse = {
  source: "openrouter/perplexity+dataforseo";
  domain: string;
  prompts: string[];
  dataIssues: string[];
  totalGaps: number;
  gapScore: number;
  gaps: ContentGap[];
  coveredPrompts: string[];
};

type GapPriorityResult = {
  prompt: string;
  priority: "critical" | "high" | "medium" | "low";
  suggestedContentAngle: string;
};

function normalizeDomain(url: string): string {
  return url
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]
    .toLowerCase();
}

async function fetchGapPriorities(
  gapItems: Array<{ prompt: string; competitorCount: number }>,
  apiKey: string,
): Promise<GapPriorityResult[]> {
  const userMsg = gapItems
    .map(
      (g) =>
        `- "${g.prompt}" (${g.competitorCount} competitor(s) cited, you are not)`,
    )
    .join("\n");

  let res: Response;
  try {
    res = await openrouterFetch("content-gap", {
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
          { role: "system", content: GAP_SYSTEM_PROMPT },
          { role: "user", content: userMsg },
        ],
        temperature: 0.3,
        max_tokens: 1024,
        response_format: { type: "json_object" },
      }),
    });
  } catch (err) {
    logExternalFailure("openrouter", "content-gap.fetchGapPriorities", err);
    return [];
  }

  if (!res.ok) {
    logExternalFailure(
      "openrouter",
      "content-gap.fetchGapPriorities",
      new Error(`HTTP ${res.status}`),
      { status: res.status },
    );
    return [];
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = json.choices?.[0]?.message?.content ?? "";
  try {
    const parsed = JSON.parse(content);
    const arr = Array.isArray(parsed)
      ? parsed
      : ((parsed as { results?: unknown[] }).results ?? []);
    return arr as GapPriorityResult[];
  } catch (err) {
    logExternalFailure("openrouter", "content-gap.fetchGapPriorities", err);
    return [];
  }
}

export async function buildContentGapResponse({
  domain,
  competitors,
  prompts,
  apiKey,
  dataForSeoLogin,
  dataForSeoPassword,
}: {
  domain: string;
  competitors: string[];
  prompts: string[];
  apiKey: string;
  dataForSeoLogin?: string;
  dataForSeoPassword?: string;
}): Promise<ContentGapResponse> {
  const dataIssues: string[] = [];
  const yourDomain = normalizeDomain(domain);
  const normalizedCompetitors = competitors.map(normalizeDomain);

  const visibilityResponse = await buildCompetitorVisibilityResponse({
    domain: yourDomain,
    competitors: normalizedCompetitors,
    prompts,
    apiKey,
  });

  dataIssues.push(...visibilityResponse.dataIssues);

  // Identify gaps: prompts where you are not cited but at least one competitor is
  const gapPrompts: string[] = [];
  const coveredPrompts: string[] = [];
  const gapCompetitors: Map<string, string[]> = new Map();

  for (const prompt of prompts) {
    const yourResult =
      visibilityResponse.yourDomainVisibility?.promptResults.find(
        (r) => r.prompt === prompt,
      );
    const yourCited = yourResult?.cited ?? false;

    const citedCompetitors: string[] = [];
    for (const domainVis of visibilityResponse.domains) {
      if (domainVis.isYourDomain) continue;
      const compResult = domainVis.promptResults.find(
        (r) => r.prompt === prompt,
      );
      if (compResult?.cited) {
        citedCompetitors.push(domainVis.domain);
      }
    }

    if (!yourCited && citedCompetitors.length > 0) {
      gapPrompts.push(prompt);
      gapCompetitors.set(prompt, citedCompetitors);
    } else if (yourCited) {
      coveredPrompts.push(prompt);
    }
  }

  // Fetch PAA for gap prompts in parallel (if DataForSEO available)
  const relatedQuestionsMap: Map<string, string[]> = new Map();
  if (dataForSeoLogin && dataForSeoPassword && gapPrompts.length > 0) {
    const serpResults = await Promise.allSettled(
      gapPrompts.map((p) =>
        fetchDataForSeoSerp({
          keyword: p,
          login: dataForSeoLogin,
          password: dataForSeoPassword,
        }),
      ),
    );

    for (let i = 0; i < gapPrompts.length; i++) {
      const prompt = gapPrompts[i];
      if (!prompt) continue;
      const result = serpResults[i];
      if (result?.status === "fulfilled") {
        const serpData = extractDataForSeoSerpData(result.value);
        relatedQuestionsMap.set(
          prompt,
          serpData.peopleAlsoAsk.map((p) => p.question).filter(Boolean),
        );
      } else if (result?.status === "rejected") {
        dataIssues.push(`PAA fetch failed for "${prompt}"`);
      }
    }
  }

  // LLM gap prioritization
  const gapItems = gapPrompts.map((p) => ({
    prompt: p,
    competitorCount: gapCompetitors.get(p)?.length ?? 0,
  }));

  const priorities =
    gapItems.length > 0 ? await fetchGapPriorities(gapItems, apiKey) : [];

  const priorityMap = new Map<string, GapPriorityResult>();
  for (const p of priorities) {
    priorityMap.set(p.prompt, p);
  }

  const gaps: ContentGap[] = gapPrompts.map((prompt) => {
    const competitorsCited = gapCompetitors.get(prompt) ?? [];
    const prio = priorityMap.get(prompt);
    return {
      prompt,
      competitorsCited,
      competitorCitationCount: competitorsCited.length,
      relatedQuestions: relatedQuestionsMap.get(prompt) ?? [],
      priority: prio?.priority ?? "medium",
      suggestedContentAngle: prio?.suggestedContentAngle ?? "",
    };
  });

  const gapScore =
    prompts.length > 0
      ? Math.round((gapPrompts.length / prompts.length) * 100)
      : 0;

  return {
    source: "openrouter/perplexity+dataforseo",
    domain: yourDomain,
    prompts,
    dataIssues,
    totalGaps: gaps.length,
    gapScore,
    gaps,
    coveredPrompts,
  };
}
