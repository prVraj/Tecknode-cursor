import {
  extractDataForSeoSerpData,
  fetchDataForSeoSerp,
} from "@/lib/dataforseo";
import { openrouterFetch } from "@/lib/intel/clients/openrouter-chat";
import { logExternalFailure } from "@/utils/log-external";

const CITATION_SYSTEM_PROMPT =
  "You are a helpful assistant. When answering questions, always list your sources as URLs in a 'Citations:' section at the end of your response. Include 3-8 specific URLs directly relevant to the topic.";
const URL_REGEX = /https?:\/\/[^\s"',)\]>]+/g;

const SOCIAL_DOMAINS: Record<string, "reddit" | "youtube" | "tiktok" | "hn"> = {
  "reddit.com": "reddit",
  "www.reddit.com": "reddit",
  "youtube.com": "youtube",
  "www.youtube.com": "youtube",
  "tiktok.com": "tiktok",
  "www.tiktok.com": "tiktok",
  "news.ycombinator.com": "hn",
};

export type SocialSignalItem = {
  url: string;
  platform: "reddit" | "youtube" | "tiktok" | "hn" | "other";
  title: string | null;
  serpPosition: number | null;
  citedByAi: boolean;
  citedByPlatforms: string[];
  prompt: string;
};

export type SocialSignalsResponse = {
  source: "dataforseo+openrouter";
  prompts: string[];
  yourBrand: string | null;
  dataIssues: string[];
  socialSignals: SocialSignalItem[];
  citedSocialContent: SocialSignalItem[];
  serpOnlySocialContent: SocialSignalItem[];
  platformBreakdown: Record<string, { serpCount: number; citedCount: number }>;
  insights: string[];
};

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

function getDomainFromUrl(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return url
      .replace(/^https?:\/\//, "")
      .split("/")[0]
      .toLowerCase();
  }
}

function getSocialPlatform(
  url: string,
): "reddit" | "youtube" | "tiktok" | "hn" | null {
  const domain = getDomainFromUrl(url);
  return SOCIAL_DOMAINS[domain] ?? null;
}

async function fetchCitationsInline(
  prompt: string,
  model: string,
  apiKey: string,
): Promise<{ citations: string[]; platform: string; dataIssue?: string }> {
  let res: Response;
  try {
    res = await openrouterFetch("social-signals", {
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
    logExternalFailure(
      "openrouter",
      "social-signals.fetchCitationsInline",
      err,
      { model },
    );
    return {
      citations: [],
      platform: model,
      dataIssue: err instanceof Error ? err.message : "Network error",
    };
  }

  if (!res.ok) {
    logExternalFailure(
      "openrouter",
      "social-signals.fetchCitationsInline",
      new Error(`HTTP ${res.status}`),
      { model, status: res.status },
    );
    return {
      citations: [],
      platform: model,
      dataIssue: `${model} returned HTTP ${res.status}`,
    };
  }

  const json = (await res.json()) as {
    citations?: string[];
    choices?: Array<{ message?: { content?: string } }>;
  };

  if (Array.isArray(json.citations) && json.citations.length > 0) {
    return { citations: json.citations, platform: model };
  }

  const content = json.choices?.[0]?.message?.content ?? "";
  return { citations: extractUrlsFromContent(content), platform: model };
}

async function fetchLlmInsights(
  items: SocialSignalItem[],
  apiKey: string,
): Promise<string[]> {
  if (items.length === 0) return [];

  const userMsg = items
    .map((i) => `- [${i.platform}] ${i.url} (prompt: "${i.prompt}")`)
    .join("\n");

  let res: Response;
  try {
    res = await openrouterFetch("social-signals", {
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
          {
            role: "system",
            content:
              'You are an AI search optimization expert. Given social content cited by AI engines, identify 3-5 themes that explain why this content ranks in AI citations. Return a JSON object: { "insights": ["theme 1", "theme 2", ...] }.',
          },
          {
            role: "user",
            content: `What themes explain why this social content is cited by AI engines?\n\n${userMsg}\n\nReturn ONLY a JSON object: { "insights": ["theme 1", "theme 2", ...] }`,
          },
        ],
        temperature: 0.3,
        max_tokens: 512,
        response_format: { type: "json_object" },
      }),
    });
  } catch (err) {
    logExternalFailure("openrouter", "social-signals.fetchLlmInsights", err);
    return [];
  }

  if (!res.ok) {
    logExternalFailure(
      "openrouter",
      "social-signals.fetchLlmInsights",
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
    const parsed = JSON.parse(content) as { insights?: string[] };
    return Array.isArray(parsed.insights) ? parsed.insights : [];
  } catch (err) {
    logExternalFailure("openrouter", "social-signals.fetchLlmInsights", err);
    return [];
  }
}

export async function buildSocialSignalsResponse({
  prompts,
  yourBrand,
  apiKey,
  login,
  password,
}: {
  prompts: string[];
  yourBrand?: string;
  apiKey: string;
  login: string;
  password: string;
}): Promise<SocialSignalsResponse> {
  const dataIssues: string[] = [];

  type PromptResult = {
    prompt: string;
    serpSocialUrls: Array<{
      url: string;
      title: string | null;
      position: number;
    }>;
    aiCitedUrls: Array<{ url: string; platform: string }>;
  };

  const promptResults = await Promise.allSettled(
    prompts.map(async (prompt): Promise<PromptResult> => {
      const [serpResult, citationResult] = await Promise.allSettled([
        fetchDataForSeoSerp({ keyword: prompt, login, password }),
        fetchCitationsInline(prompt, "perplexity/sonar-pro", apiKey),
      ]);

      const serpSocialUrls: Array<{
        url: string;
        title: string | null;
        position: number;
      }> = [];
      // A failed SERP or citations sub-call silently drops that prompt's social
      // URLs, understating the counts. Lift the failure to the top-level
      // dataIssues so `hasStoredDataIssues` sees it and a zeroed score can't be
      // diffed into a false delta signal (if this capability ever gets a
      // primaryScoreField).
      if (serpResult.status === "fulfilled") {
        const serpData = extractDataForSeoSerpData(serpResult.value);
        for (const item of serpData.organic) {
          if (getSocialPlatform(item.link)) {
            serpSocialUrls.push({
              url: item.link,
              title: item.title,
              position: item.position,
            });
          }
        }
      } else {
        dataIssues.push(`SERP fetch failed for prompt "${prompt}"`);
      }

      const aiCitedUrls: Array<{ url: string; platform: string }> = [];
      if (citationResult.status === "fulfilled") {
        if (citationResult.value.dataIssue) {
          dataIssues.push(
            `AI citations issue for "${prompt}": ${citationResult.value.dataIssue}`,
          );
        }
        for (const url of citationResult.value.citations) {
          if (getSocialPlatform(url)) {
            aiCitedUrls.push({ url, platform: citationResult.value.platform });
          }
        }
      } else {
        dataIssues.push(`AI citations fetch failed for prompt "${prompt}"`);
      }

      return { prompt, serpSocialUrls, aiCitedUrls };
    }),
  );

  const allItems: SocialSignalItem[] = [];

  for (let i = 0; i < promptResults.length; i++) {
    const outcome = promptResults[i];
    if (!outcome || outcome.status === "rejected") {
      dataIssues.push(`Failed to fetch signals for prompt "${prompts[i]}"`);
      continue;
    }

    const { prompt, serpSocialUrls, aiCitedUrls } = outcome.value;
    const aiUrlSet = new Set(aiCitedUrls.map((c) => c.url));
    const aiPlatformMap = new Map<string, string[]>();
    for (const c of aiCitedUrls) {
      const existing = aiPlatformMap.get(c.url) ?? [];
      existing.push(c.platform);
      aiPlatformMap.set(c.url, existing);
    }

    const seenUrls = new Set<string>();

    for (const serpItem of serpSocialUrls) {
      if (seenUrls.has(serpItem.url)) continue;
      seenUrls.add(serpItem.url);

      const platform = getSocialPlatform(serpItem.url) ?? "other";
      allItems.push({
        url: serpItem.url,
        platform,
        title: serpItem.title,
        serpPosition: serpItem.position,
        citedByAi: aiUrlSet.has(serpItem.url),
        citedByPlatforms: aiPlatformMap.get(serpItem.url) ?? [],
        prompt,
      });
    }

    // AI cited but not in SERP
    for (const cited of aiCitedUrls) {
      if (seenUrls.has(cited.url)) continue;
      seenUrls.add(cited.url);

      const platform = getSocialPlatform(cited.url) ?? "other";
      allItems.push({
        url: cited.url,
        platform,
        title: null,
        serpPosition: null,
        citedByAi: true,
        citedByPlatforms: [cited.platform],
        prompt,
      });
    }
  }

  const citedSocialContent = allItems.filter((i) => i.citedByAi);
  const serpOnlySocialContent = allItems.filter(
    (i) => !i.citedByAi && i.serpPosition !== null,
  );

  const platformBreakdown: Record<
    string,
    { serpCount: number; citedCount: number }
  > = {};
  for (const item of allItems) {
    const p = item.platform;
    if (!platformBreakdown[p])
      platformBreakdown[p] = { serpCount: 0, citedCount: 0 };
    if (item.serpPosition !== null) platformBreakdown[p].serpCount += 1;
    if (item.citedByAi) platformBreakdown[p].citedCount += 1;
  }

  const insights = await fetchLlmInsights(citedSocialContent, apiKey);

  return {
    source: "dataforseo+openrouter",
    prompts,
    yourBrand: yourBrand ?? null,
    dataIssues,
    socialSignals: allItems,
    citedSocialContent,
    serpOnlySocialContent,
    platformBreakdown,
    insights,
  };
}
