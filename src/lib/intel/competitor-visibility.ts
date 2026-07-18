import { openrouterFetch } from "@/lib/intel/clients/openrouter-chat";

const SEARCH_PLATFORMS = [
  { model: "perplexity/sonar-pro", label: "Perplexity Sonar Pro" },
  { model: "perplexity/sonar", label: "Perplexity Sonar" },
] as const;

const CITATION_SYSTEM_PROMPT =
  "You are a helpful assistant. When answering questions, always list your sources as URLs in a 'Citations:' section at the end of your response. Include 3-8 specific URLs directly relevant to the topic.";

const URL_REGEX = /https?:\/\/[^\s"',)\]>]+/g;

export type VisibilityDomain = {
  domain: string;
  isYourDomain: boolean;
  citationShare: number;
  citedPromptCount: number;
  totalPrompts: number;
  dominantPlatform: string | null;
  promptResults: Array<{
    prompt: string;
    cited: boolean;
    platforms: string[];
  }>;
};

export type CompetitorVisibilityResponse = {
  source: "openrouter/perplexity";
  yourDomain: string;
  prompts: string[];
  dataIssues: string[];
  domains: VisibilityDomain[];
  yourDomainVisibility: VisibilityDomain | null;
  marketLeader: string | null;
  heatmap: Record<string, Record<string, boolean>>;
};

function normalizeDomain(url: string): string {
  return url
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]
    .toLowerCase();
}

function isDomainInCitations(domain: string, citations: string[]): boolean {
  const normalized = normalizeDomain(domain);
  return citations.some((url) => {
    const d = normalizeDomain(url);
    return d === normalized || d.endsWith(`.${normalized}`);
  });
}

function extractUrlsFromContent(content: string): string[] {
  const matches = content.match(URL_REGEX) ?? [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const url of matches) {
    const clean = url.replace(/[.,;:!?]$/, "");
    if (!seen.has(clean)) {
      seen.add(clean);
      result.push(clean);
    }
  }
  return result;
}

async function fetchCitationsFromPlatform(
  prompt: string,
  model: string,
  apiKey: string,
): Promise<{ citations: string[]; dataIssue?: string }> {
  let res: Response;
  try {
    res = await openrouterFetch("competitor-visibility", {
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
          { role: "system", content: CITATION_SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
        temperature: 0.1,
        max_tokens: 1024,
      }),
    });
  } catch (err) {
    return {
      citations: [],
      dataIssue: err instanceof Error ? err.message : "Network error",
    };
  }

  if (!res.ok) {
    return {
      citations: [],
      dataIssue: `${model} returned HTTP ${res.status}`,
    };
  }

  const json = (await res.json()) as {
    citations?: string[];
    choices?: Array<{ message?: { content?: string } }>;
  };

  if (Array.isArray(json.citations) && json.citations.length > 0) {
    return { citations: json.citations };
  }

  const content = json.choices?.[0]?.message?.content ?? "";
  return { citations: extractUrlsFromContent(content) };
}

// Track per-domain, per-prompt, per-platform citation status
type RawCitationMatrix = Map<
  string, // domain
  Map<
    string, // prompt
    Set<string> // platforms that cited
  >
>;

function buildRawMatrix(allDomains: string[]): RawCitationMatrix {
  const matrix: RawCitationMatrix = new Map();
  for (const domain of allDomains) {
    matrix.set(domain, new Map());
  }
  return matrix;
}

function updateMatrix(
  matrix: RawCitationMatrix,
  allDomains: string[],
  prompt: string,
  platformLabel: string,
  citations: string[],
): void {
  for (const domain of allDomains) {
    const domainMap = matrix.get(domain);
    if (!domainMap) continue;

    if (!domainMap.has(prompt)) {
      domainMap.set(prompt, new Set());
    }

    if (isDomainInCitations(domain, citations)) {
      domainMap.get(prompt)?.add(platformLabel);
    }
  }
}

function buildVisibilityDomain(
  domain: string,
  yourDomain: string,
  prompts: string[],
  domainMap: Map<string, Set<string>>,
): VisibilityDomain {
  const promptResults = prompts.map((prompt) => {
    const platforms = domainMap.get(prompt) ?? new Set<string>();
    return {
      prompt,
      cited: platforms.size > 0,
      platforms: Array.from(platforms),
    };
  });

  const citedPromptCount = promptResults.filter((r) => r.cited).length;
  const totalPrompts = prompts.length;
  const citationShare =
    totalPrompts > 0
      ? Math.round((citedPromptCount / totalPrompts) * 1000) / 10
      : 0;

  const dominantPlatform = computeDominantPlatform(promptResults);

  return {
    domain,
    isYourDomain: normalizeDomain(domain) === normalizeDomain(yourDomain),
    citationShare,
    citedPromptCount,
    totalPrompts,
    dominantPlatform,
    promptResults,
  };
}

function computeDominantPlatform(
  promptResults: VisibilityDomain["promptResults"],
): string | null {
  const counts: Record<string, number> = {};
  for (const r of promptResults) {
    for (const p of r.platforms) {
      counts[p] = (counts[p] ?? 0) + 1;
    }
  }

  let best: string | null = null;
  let bestCount = 0;
  for (const [platform, count] of Object.entries(counts)) {
    if (count > bestCount) {
      bestCount = count;
      best = platform;
    }
  }
  return best;
}

function buildHeatmap(
  allDomains: string[],
  prompts: string[],
  matrix: RawCitationMatrix,
): Record<string, Record<string, boolean>> {
  const heatmap: Record<string, Record<string, boolean>> = {};
  for (const domain of allDomains) {
    heatmap[domain] = {};
    const domainMap = matrix.get(domain) ?? new Map();
    for (const prompt of prompts) {
      const platforms = domainMap.get(prompt) ?? new Set();
      heatmap[domain][prompt] = platforms.size > 0;
    }
  }
  return heatmap;
}

export async function buildCompetitorVisibilityResponse({
  domain,
  competitors,
  prompts,
  apiKey,
}: {
  domain: string;
  competitors: string[];
  prompts: string[];
  apiKey: string;
}): Promise<CompetitorVisibilityResponse> {
  const dataIssues: string[] = [];
  const yourDomain = normalizeDomain(domain);
  const normalizedCompetitors = competitors.map(normalizeDomain);
  const allDomains = [yourDomain, ...normalizedCompetitors];

  const matrix = buildRawMatrix(allDomains);

  const tasks = SEARCH_PLATFORMS.flatMap((platform) =>
    prompts.map((prompt) => ({ platform, prompt })),
  );

  const settled = await Promise.allSettled(
    tasks.map(({ platform, prompt }) =>
      fetchCitationsFromPlatform(prompt, platform.model, apiKey),
    ),
  );

  for (let i = 0; i < tasks.length; i++) {
    const { platform, prompt } = tasks[i];
    const outcome = settled[i];

    if (outcome.status === "rejected") {
      const msg =
        outcome.reason instanceof Error
          ? outcome.reason.message
          : "Unknown error";
      dataIssues.push(
        `${platform.label} failed for prompt "${prompt}": ${msg}`,
      );
      continue;
    }

    if (outcome.value.dataIssue) {
      dataIssues.push(`${platform.label}: ${outcome.value.dataIssue}`);
    }

    updateMatrix(
      matrix,
      allDomains,
      prompt,
      platform.label,
      outcome.value.citations,
    );
  }

  const visibilityDomains: VisibilityDomain[] = allDomains.map((d) =>
    buildVisibilityDomain(d, yourDomain, prompts, matrix.get(d) ?? new Map()),
  );

  // Sort by citationShare descending
  visibilityDomains.sort((a, b) => b.citationShare - a.citationShare);

  const yourDomainVisibility =
    visibilityDomains.find((d) => d.isYourDomain) ?? null;
  const marketLeader =
    visibilityDomains.length > 0 ? visibilityDomains[0].domain : null;

  const heatmap = buildHeatmap(allDomains, prompts, matrix);

  return {
    source: "openrouter/perplexity",
    yourDomain,
    prompts,
    dataIssues,
    domains: visibilityDomains,
    yourDomainVisibility,
    marketLeader,
    heatmap,
  };
}
