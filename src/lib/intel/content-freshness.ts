import { scrape } from "@/lib/intel/clients/firecrawl";
import { openrouterFetch } from "@/lib/intel/clients/openrouter-chat";
import { logExternalFailure } from "@/utils/log-external";

const MODEL = "openai/gpt-4o-mini";

export type FreshnessSignal = {
  source: "http_header" | "schema_org" | "meta_tag" | "visible_text";
  date: string;
  label: string;
};

export type ContentFreshnessItem = {
  url: string;
  lastModifiedHeader: string | null;
  publishedDate: string | null;
  modifiedDate: string | null;
  bestDate: string | null;
  daysAgo: number | null;
  freshnessStatus: "fresh" | "stale" | "very_stale" | "unknown";
  signals: FreshnessSignal[];
  wordCount: number | null;
  dataIssue?: string;
};

export type ContentFreshnessResponse = {
  source: "firecrawl+openrouter";
  dataIssues: string[];
  pages: ContentFreshnessItem[];
};

export function countWords(markdown: string): number {
  return markdown.split(/\s+/).filter(Boolean).length;
}

export async function checkHttpLastModified(
  url: string,
): Promise<{ lastModified: string | null; dataIssue?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
    });
    clearTimeout(timer);
    const lastModified = res.headers.get("last-modified");
    return { lastModified };
  } catch (err) {
    clearTimeout(timer);
    const message = err instanceof Error ? err.message : "HEAD request failed";
    logExternalFailure(
      "fetch",
      "content-freshness.checkHttpLastModified",
      err,
      { url },
    );
    return { lastModified: null, dataIssue: `HEAD ${url}: ${message}` };
  }
}

// Key read from env by the shared cached client.
async function fetchPageMarkdown(
  url: string,
): Promise<{ markdown: string; dataIssue?: string }> {
  try {
    const res = await scrape(url);
    return { markdown: res.data?.markdown ?? "" };
  } catch (err) {
    logExternalFailure(
      "firecrawl",
      "content-freshness.fetchPageMarkdown",
      err,
      {
        url,
      },
    );
    return {
      markdown: "",
      dataIssue: err instanceof Error ? err.message : "Firecrawl error",
    };
  }
}

const DATE_EXTRACTION_SYSTEM_PROMPT = `You are an expert at extracting publication and modification dates from web page content.

Look for dates in:
1. JSON-LD schema.org data (datePublished, dateModified)
2. Meta tags (article:published_time, article:modified_time, og:updated_time)
3. Visible text patterns ("Published:", "Updated:", "Last updated:", "Posted:", etc.)

Return ONLY valid JSON:
{
  "publishedDate": "<ISO 8601 date or null>",
  "modifiedDate": "<ISO 8601 date or null>",
  "signals": [
    { "source": "<schema_org|meta_tag|visible_text>", "date": "<date string as found>", "label": "<field name or description>" }
  ]
}

If no date found, return { "publishedDate": null, "modifiedDate": null, "signals": [] }`;

type LlmDateResult = {
  publishedDate: string | null;
  modifiedDate: string | null;
  signals: Array<{
    source: "schema_org" | "meta_tag" | "visible_text";
    date: string;
    label: string;
  }>;
};

export async function extractPageDatesWithLlm(
  markdown: string,
  url: string,
  apiKey: string,
): Promise<{ result: LlmDateResult | null; dataIssue?: string }> {
  const truncated = markdown.slice(0, 8000);

  let res: Response;
  try {
    res = await openrouterFetch("content-freshness", {
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
          { role: "system", content: DATE_EXTRACTION_SYSTEM_PROMPT },
          {
            role: "user",
            content: `Extract all date signals from this page.\n\nURL: ${url}\n\n${truncated}`,
          },
        ],
        temperature: 0,
        max_tokens: 512,
        response_format: { type: "json_object" },
      }),
    });
  } catch (err) {
    logExternalFailure(
      "openrouter",
      "content-freshness.extractPageDatesWithLlm",
      err,
      { url },
    );
    return {
      result: null,
      dataIssue: err instanceof Error ? err.message : "LLM network error",
    };
  }

  if (!res.ok) {
    logExternalFailure(
      "openrouter",
      "content-freshness.extractPageDatesWithLlm",
      new Error(`HTTP ${res.status}`),
      { url, status: res.status },
    );
    return { result: null, dataIssue: `LLM returned HTTP ${res.status}` };
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const content = json.choices?.[0]?.message?.content ?? "";
  try {
    const parsed = JSON.parse(content) as LlmDateResult;
    return { result: parsed };
  } catch (err) {
    logExternalFailure(
      "openrouter",
      "content-freshness.extractPageDatesWithLlm",
      err,
      { url },
    );
    return { result: null, dataIssue: "Failed to parse LLM JSON response" };
  }
}

export function parseBestDate(dates: (string | null)[]): {
  bestDate: string | null;
  daysAgo: number | null;
  freshnessStatus: "fresh" | "stale" | "very_stale" | "unknown";
} {
  const now = Date.now();
  let best: Date | null = null;

  for (const raw of dates) {
    if (!raw) continue;
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) continue;
    if (!best || parsed > best) best = parsed;
  }

  if (!best) {
    return { bestDate: null, daysAgo: null, freshnessStatus: "unknown" };
  }

  const daysAgo = Math.floor((now - best.getTime()) / (1000 * 60 * 60 * 24));

  let freshnessStatus: "fresh" | "stale" | "very_stale";
  if (daysAgo < 90) {
    freshnessStatus = "fresh";
  } else if (daysAgo <= 365) {
    freshnessStatus = "stale";
  } else {
    freshnessStatus = "very_stale";
  }

  return { bestDate: best.toISOString(), daysAgo, freshnessStatus };
}

async function processUrl(
  url: string,
  openrouterKey: string,
): Promise<ContentFreshnessItem> {
  const pageDataIssues: string[] = [];

  const [headResult, scrapeResult] = await Promise.all([
    checkHttpLastModified(url),
    fetchPageMarkdown(url),
  ]);

  if (headResult.dataIssue) pageDataIssues.push(headResult.dataIssue);
  if (scrapeResult.dataIssue) pageDataIssues.push(scrapeResult.dataIssue);

  const lastModifiedHeader = headResult.lastModified;

  const headerSignal: FreshnessSignal | null = lastModifiedHeader
    ? {
        source: "http_header",
        date: lastModifiedHeader,
        label: "HTTP Last-Modified",
      }
    : null;

  const wordCount = scrapeResult.markdown
    ? countWords(scrapeResult.markdown)
    : null;

  let publishedDate: string | null = null;
  let modifiedDate: string | null = null;
  const llmSignals: FreshnessSignal[] = [];

  if (scrapeResult.markdown) {
    const { result, dataIssue: llmIssue } = await extractPageDatesWithLlm(
      scrapeResult.markdown,
      url,
      openrouterKey,
    );
    if (llmIssue) pageDataIssues.push(llmIssue);
    if (result) {
      publishedDate = result.publishedDate;
      modifiedDate = result.modifiedDate;
      for (const s of result.signals) llmSignals.push(s);
    }
  }

  const { bestDate, daysAgo, freshnessStatus } = parseBestDate([
    modifiedDate,
    publishedDate,
    lastModifiedHeader,
  ]);

  const signals: FreshnessSignal[] = [
    ...(headerSignal ? [headerSignal] : []),
    ...llmSignals,
  ];

  const combinedIssue =
    pageDataIssues.length > 0 ? pageDataIssues.join("; ") : undefined;

  return {
    url,
    lastModifiedHeader,
    publishedDate,
    modifiedDate,
    bestDate,
    daysAgo,
    freshnessStatus,
    signals,
    wordCount,
    ...(combinedIssue ? { dataIssue: combinedIssue } : {}),
  };
}

export async function buildContentFreshnessResponse({
  urls,
  openrouterKey,
  dataIssues,
}: {
  urls: string[];
  openrouterKey: string;
  dataIssues: string[];
}): Promise<ContentFreshnessResponse> {
  const results = await Promise.allSettled(
    urls.map((url) => processUrl(url, openrouterKey)),
  );

  const pages: ContentFreshnessItem[] = [];

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === "fulfilled") {
      pages.push(r.value);
      if (r.value.dataIssue) dataIssues.push(r.value.dataIssue);
    } else {
      const msg =
        r.reason instanceof Error ? r.reason.message : "Unknown error";
      const issue = `Failed to process ${urls[i]}: ${msg}`;
      dataIssues.push(issue);
      pages.push({
        url: urls[i],
        lastModifiedHeader: null,
        publishedDate: null,
        modifiedDate: null,
        bestDate: null,
        daysAgo: null,
        freshnessStatus: "unknown",
        signals: [],
        wordCount: null,
        dataIssue: issue,
      });
    }
  }

  return {
    source: "firecrawl+openrouter",
    dataIssues,
    pages,
  };
}
