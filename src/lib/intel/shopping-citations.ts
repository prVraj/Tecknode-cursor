import { openrouterFetch } from "@/lib/intel/clients/openrouter-chat";
import { logExternalFailure } from "@/utils/log-external";

/**
 * Shopping-citation probe. Unlike the URL-based keyword-citation matrix, AI
 * shopping/buying-intent answers recommend products BY NAME ("Choose Runway",
 * "Synthesia for business") and frequently carry no source URLs at all
 * (OpenRouter's Perplexity responses omit the citations array). So we detect
 * whether the brand and each competitor are *recommended by name*, and in what
 * order they first appear — the order is a proxy for recommendation rank.
 */

const SHOPPING_PLATFORMS = [
  { model: "perplexity/sonar-pro", label: "Perplexity Sonar Pro" },
  { model: "perplexity/sonar", label: "Perplexity Sonar" },
] as const;

const SHOPPING_SYSTEM_PROMPT =
  "You are a shopping research assistant. Recommend specific products/brands by name, ranked best-first. Be concrete and name the actual products a buyer should consider.";

export interface ShoppingPromptResult {
  prompt: string;
  youCited: boolean;
  youPosition: number | null;
  topBrand: string | null;
  competitors: Array<{
    domain: string;
    cited: boolean;
    position: number | null;
  }>;
  competitorLeader: string | null;
  dataIssue?: string;
}

export interface ShoppingCitationReport {
  source: "openrouter/perplexity";
  yourDomain: string;
  brand: string;
  competitors: string[];
  dataIssues: string[];
  totalPrompts: number;
  promptsWhereYouLead: number;
  promptsWhereCompetitorLeads: number;
  promptsNotCited: number;
  shoppingCitationRate: number;
  results: ShoppingPromptResult[];
  competitorLeaderboard: Array<{ domain: string; promptsLed: number }>;
}

/** Distinctive lowercase name token for a domain, e.g. "krea.ai" → "krea". */
export function brandToken(domain: string): string {
  const host = domain
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]
    .toLowerCase();
  return host.split(".")[0] ?? host;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** First character index where `name` appears as a whole word, else -1. */
function firstMentionIndex(content: string, name: string): number {
  const token = name.trim().toLowerCase();
  if (token.length < 3) return -1;
  const re = new RegExp(`\\b${escapeRegExp(token)}\\b`, "i");
  const m = re.exec(content);
  return m ? m.index : -1;
}

async function fetchAnswer(
  prompt: string,
  model: string,
  apiKey: string,
): Promise<{ content: string; dataIssue?: string }> {
  try {
    const res = await openrouterFetch("shopping-citations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://runagents.co",
        "X-Title": "RunAgents Intel",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SHOPPING_SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
        temperature: 0.1,
        max_tokens: 600,
      }),
    });
    if (!res.ok) {
      return { content: "", dataIssue: `${model} returned HTTP ${res.status}` };
    }
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return { content: json.choices?.[0]?.message?.content ?? "" };
  } catch (err) {
    logExternalFailure("openrouter", "shopping-citations.fetchAnswer", err, {
      model,
    });
    return {
      content: "",
      dataIssue: err instanceof Error ? err.message : "Network error",
    };
  }
}

async function runInChunks<T>(
  tasks: Array<() => Promise<T>>,
  chunkSize: number,
): Promise<T[]> {
  const results: T[] = [];
  for (let i = 0; i < tasks.length; i += chunkSize) {
    const chunk = tasks.slice(i, i + chunkSize);
    results.push(...(await Promise.all(chunk.map((fn) => fn()))));
  }
  return results;
}

interface Entity {
  key: string; // domain (for competitors) or "you"
  tokens: string[];
}

/** Rank entities by earliest first-mention; cited = mentioned at all. */
function rankByMention(
  content: string,
  entities: Entity[],
): Map<string, { cited: boolean; position: number | null }> {
  const firstIdx = new Map<string, number>();
  for (const e of entities) {
    let best = -1;
    for (const token of e.tokens) {
      const idx = firstMentionIndex(content, token);
      if (idx >= 0 && (best === -1 || idx < best)) best = idx;
    }
    firstIdx.set(e.key, best);
  }
  const cited = entities
    .filter((e) => (firstIdx.get(e.key) ?? -1) >= 0)
    .sort((a, b) => (firstIdx.get(a.key) ?? 0) - (firstIdx.get(b.key) ?? 0));
  const out = new Map<string, { cited: boolean; position: number | null }>();
  for (const e of entities) out.set(e.key, { cited: false, position: null });
  cited.forEach((e, i) => {
    out.set(e.key, { cited: true, position: i + 1 });
  });
  return out;
}

/** Analyze a single prompt's merged answer text into a per-prompt result. */
function analyzePromptAnswer(
  prompt: string,
  content: string,
  yourTokens: string[],
  domain: string,
  competitors: string[],
): ShoppingPromptResult {
  const ranked = rankByMention(content, [
    { key: "you", tokens: yourTokens },
    ...competitors.map((c) => ({ key: c, tokens: [brandToken(c)] })),
  ]);
  const you = ranked.get("you") ?? { cited: false, position: null };

  const competitorResults = competitors.map((c) => {
    const r = ranked.get(c) ?? { cited: false, position: null };
    return { domain: c, cited: r.cited, position: r.position };
  });

  const youPos = you.position ?? Number.POSITIVE_INFINITY;
  let competitorLeader: string | null = null;
  let leaderPos = Number.POSITIVE_INFINITY;
  for (const c of competitorResults) {
    if (c.position !== null && c.position < youPos && c.position < leaderPos) {
      competitorLeader = c.domain;
      leaderPos = c.position;
    }
  }

  let topBrand: string | null = null;
  if (you.position === 1) topBrand = domain;
  else
    topBrand = competitorResults.find((c) => c.position === 1)?.domain ?? null;

  return {
    prompt,
    youCited: you.cited,
    youPosition: you.position,
    topBrand,
    competitors: competitorResults,
    competitorLeader,
  };
}

export async function buildShoppingCitationReport({
  domain,
  brand,
  competitors,
  prompts,
  apiKey,
}: {
  domain: string;
  brand: string;
  competitors: string[];
  prompts: string[];
  apiKey: string;
}): Promise<ShoppingCitationReport> {
  const yourTokens = Array.from(
    new Set([brandToken(domain), brand.toLowerCase()].filter(Boolean)),
  );

  const taskDefs = prompts.flatMap((prompt) =>
    SHOPPING_PLATFORMS.map((platform) => ({ prompt, platform })),
  );
  const answers = await runInChunks(
    taskDefs.map(
      ({ prompt, platform }) =>
        () =>
          fetchAnswer(prompt, platform.model, apiKey),
    ),
    10,
  );

  // Merge both platform answers per prompt.
  const byPrompt = new Map<string, { content: string; issue?: string }>();
  taskDefs.forEach((def, i) => {
    const existing = byPrompt.get(def.prompt) ?? { content: "" };
    existing.content += `\n${answers[i].content}`;
    if (answers[i].dataIssue && !existing.issue)
      existing.issue = answers[i].dataIssue;
    byPrompt.set(def.prompt, existing);
  });

  const dataIssues: string[] = [];
  const results: ShoppingPromptResult[] = [];
  const compLeadMap = new Map<string, number>();

  for (const prompt of prompts) {
    const { content, issue } = byPrompt.get(prompt) ?? { content: "" };
    if (issue) dataIssues.push(`[${prompt}] ${issue}`);

    const result = analyzePromptAnswer(
      prompt,
      content,
      yourTokens,
      domain,
      competitors,
    );
    if (result.competitorLeader) {
      compLeadMap.set(
        result.competitorLeader,
        (compLeadMap.get(result.competitorLeader) ?? 0) + 1,
      );
    }
    results.push(result);
  }

  const promptsWhereYouLead = results.filter((r) => r.youPosition === 1).length;
  const promptsNotCited = results.filter((r) => !r.youCited).length;
  const promptsWhereCompetitorLeads = results.filter(
    (r) => r.competitorLeader !== null,
  ).length;
  const citedCount = results.filter((r) => r.youCited).length;
  const shoppingCitationRate =
    results.length > 0 ? Math.round((citedCount / results.length) * 100) : 0;

  const competitorLeaderboard = Array.from(compLeadMap.entries())
    .map(([d, promptsLed]) => ({ domain: d, promptsLed }))
    .sort((a, b) => b.promptsLed - a.promptsLed);

  return {
    source: "openrouter/perplexity",
    yourDomain: brandToken(domain),
    brand,
    competitors,
    dataIssues,
    totalPrompts: results.length,
    promptsWhereYouLead,
    promptsWhereCompetitorLeads,
    promptsNotCited,
    shoppingCitationRate,
    results,
    competitorLeaderboard,
  };
}
