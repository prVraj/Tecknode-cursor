import { scrape } from "@/lib/intel/clients/firecrawl";
import { openrouterFetch } from "@/lib/intel/clients/openrouter-chat";
import { logExternalFailure } from "@/utils/log-external";

const MODEL = "openai/gpt-4o-mini";

export type ContentImprovement = {
  type: string;
  priority: "high" | "medium" | "low";
  suggestion: string;
};

export type ContentScoreResponse = {
  source: "firecrawl+openrouter";
  url: string;
  keyword: string;
  contentScore: number;
  competitorAvgScore: number;
  gap: number;
  wordCount: number | null;
  competitorAvgWordCount: number | null;
  improvements: ContentImprovement[];
  dataIssues: string[];
};

// Routed through the shared, cached Firecrawl client so sibling page/SEO
// signals reuse one scrape per URL/day. The API key is read from env by the
// client.
export async function fetchPageMarkdown(
  url: string,
): Promise<{ markdown: string; dataIssue?: string }> {
  try {
    const res = await scrape(url);
    return { markdown: res.data?.markdown ?? "" };
  } catch (err) {
    logExternalFailure("firecrawl", "content-score.fetchPageMarkdown", err, {
      url,
    });
    return {
      markdown: "",
      dataIssue: err instanceof Error ? err.message : "Firecrawl error",
    };
  }
}

function countWords(markdown: string): number {
  return markdown.split(/\s+/).filter(Boolean).length;
}

const CONTENT_SCORE_SYSTEM_PROMPT = `You are an on-page SEO specialist scoring a target page against its top competitors for a specific keyword.

Evaluate the target page on:
1. Keyword coverage (does the content address the primary topic and related subtopics?)
2. Entity coverage (are relevant entities, tools, brands, concepts mentioned?)
3. Content depth (thoroughness, detail level compared to competitors)
4. Structure quality (headings, subheadings, lists, tables)
5. Readability (clear writing, good flow)

Return ONLY valid JSON with this exact schema:
{
  "targetScore": <0-100>,
  "competitorScores": [<0-100>, <0-100>, ...],
  "improvements": [
    { "type": "<entity_coverage|content_depth|keyword_coverage|structure|readability>", "priority": "<high|medium|low>", "suggestion": "<specific actionable suggestion>" }
  ]
}

The improvements array should have 3-6 concrete, actionable suggestions ordered by priority. Reference specific entities or terms from competitor content that are missing from the target.`;

type LlmScoreResult = {
  targetScore: number;
  competitorScores: number[];
  improvements: ContentImprovement[];
};

async function scoreContentWithLlm(
  targetMarkdown: string,
  competitorMarkdowns: string[],
  targetUrl: string,
  keyword: string,
  apiKey: string,
): Promise<{ result: LlmScoreResult | null; dataIssue?: string }> {
  const targetTruncated = targetMarkdown.slice(0, 6000);
  const competitorSections = competitorMarkdowns
    .map((md, i) => `### Competitor ${i + 1}\n\n${md.slice(0, 3000)}`)
    .join("\n\n");

  const userMsg = `Keyword: "${keyword}"

Target page URL: ${targetUrl}

## Target Page Content
${targetTruncated}

## Top Competitor Pages
${competitorSections}`;

  let res: Response;
  try {
    res = await openrouterFetch("content-score", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://runagents.co",
        "X-Title": "RunAgents Intel",
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: CONTENT_SCORE_SYSTEM_PROMPT },
          { role: "user", content: userMsg },
        ],
        temperature: 0.1,
        max_tokens: 1536,
        response_format: { type: "json_object" },
      }),
    });
  } catch (err) {
    logExternalFailure("openrouter", "content-score.scoreContentWithLlm", err, {
      url: targetUrl,
    });
    return {
      result: null,
      dataIssue: err instanceof Error ? err.message : "LLM network error",
    };
  }

  if (!res.ok) {
    logExternalFailure(
      "openrouter",
      "content-score.scoreContentWithLlm",
      new Error(`HTTP ${res.status}`),
      { url: targetUrl, status: res.status },
    );
    return { result: null, dataIssue: `LLM returned HTTP ${res.status}` };
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const content = json.choices?.[0]?.message?.content ?? "";
  try {
    const parsed = JSON.parse(content) as LlmScoreResult;
    return { result: parsed };
  } catch (err) {
    logExternalFailure("openrouter", "content-score.scoreContentWithLlm", err, {
      url: targetUrl,
    });
    return { result: null, dataIssue: "Failed to parse LLM JSON response" };
  }
}

export async function buildContentScoreResponse({
  url,
  keyword,
  competitorUrls,
  openrouterKey,
  dataIssues,
}: {
  url: string;
  keyword: string;
  competitorUrls: string[];
  openrouterKey: string;
  dataIssues: string[];
}): Promise<ContentScoreResponse> {
  const allUrls = [url, ...competitorUrls.slice(0, 3)];

  const scrapeResults = await Promise.allSettled(
    allUrls.map((u) => fetchPageMarkdown(u)),
  );

  const targetScrape =
    scrapeResults[0].status === "fulfilled"
      ? scrapeResults[0].value
      : { markdown: "", dataIssue: "Target page scrape failed" };

  if (targetScrape.dataIssue) dataIssues.push(targetScrape.dataIssue);

  const competitorMarkdowns: string[] = [];
  for (let i = 1; i < scrapeResults.length; i++) {
    const r = scrapeResults[i];
    if (r.status === "fulfilled") {
      competitorMarkdowns.push(r.value.markdown);
      if (r.value.dataIssue) dataIssues.push(r.value.dataIssue);
    } else {
      const msg =
        r.reason instanceof Error ? r.reason.message : "Scrape failed";
      dataIssues.push(`Competitor scrape failed: ${msg}`);
      competitorMarkdowns.push("");
    }
  }

  const targetWordCount = targetScrape.markdown
    ? countWords(targetScrape.markdown)
    : null;

  const competitorWordCounts = competitorMarkdowns
    .filter((md) => md.length > 0)
    .map(countWords);

  const competitorAvgWordCount =
    competitorWordCounts.length > 0
      ? Math.round(
          competitorWordCounts.reduce((a, b) => a + b, 0) /
            competitorWordCounts.length,
        )
      : null;

  const { result, dataIssue: llmIssue } = await scoreContentWithLlm(
    targetScrape.markdown,
    competitorMarkdowns,
    url,
    keyword,
    openrouterKey,
  );

  if (llmIssue) dataIssues.push(llmIssue);

  const targetScore = result?.targetScore ?? 0;
  const compScores = result?.competitorScores ?? [];
  const competitorAvgScore =
    compScores.length > 0
      ? Math.round(compScores.reduce((a, b) => a + b, 0) / compScores.length)
      : 0;

  return {
    source: "firecrawl+openrouter",
    url,
    keyword,
    contentScore: targetScore,
    competitorAvgScore,
    gap: targetScore - competitorAvgScore,
    wordCount: targetWordCount,
    competitorAvgWordCount,
    improvements: result?.improvements ?? [],
    dataIssues,
  };
}
