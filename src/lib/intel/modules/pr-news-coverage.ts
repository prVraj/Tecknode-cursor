import { openrouterFetch } from "@/lib/intel/clients/openrouter-chat";
import { signalSnapshotRepo } from "@/server/db/repos/signal-snapshot.repo";
import type { NewSignal } from "@/server/db/schema";
import type { ModuleRunner } from "../dispatcher";
import {
  asOutput,
  getBrand,
  getDataForSeoCredentials,
  requireEnv,
} from "./module-helpers";

const NEWS_URL = "https://api.dataforseo.com/v3/serp/google/news/live/advanced";

type NewsItem = {
  type?: string;
  title?: string;
  url?: string;
  domain?: string;
  timestamp?: string;
};

type ArticleTopic =
  | "product_launch"
  | "funding"
  | "controversy"
  | "partnership"
  | "leadership"
  | "other";
type ArticleSentiment = "positive" | "neutral" | "negative";

async function fetchNewsArticles(
  brand: string,
  credentials: string,
): Promise<NewsItem[]> {
  const response = await fetch(NEWS_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([
      {
        keyword: brand,
        depth: 50,
        language_code: "en",
        date_range: "past_month",
      },
    ]),
  });
  if (!response.ok) return [];
  const data = (await response.json()) as {
    tasks?: { result?: { items?: NewsItem[] }[] }[];
  };
  return (data.tasks?.[0]?.result?.[0]?.items ?? []).filter(
    (item) => item.type === "news",
  );
}

async function classifyArticles(
  titles: string[],
  apiKey: string,
): Promise<{ topic: ArticleTopic; sentiment: ArticleSentiment }[]> {
  if (titles.length === 0) return [];
  const response = await openrouterFetch("pr-news-coverage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Classify each news headline. Return JSON: {results: [{topic: string, sentiment: string}]}. Topic: product_launch|funding|controversy|partnership|leadership|other. Sentiment: positive|neutral|negative.",
        },
        {
          role: "user",
          content: `Headlines:\n${titles.map((t, i) => `${i + 1}. ${t}`).join("\n")}`,
        },
      ],
    }),
  });
  if (!response.ok)
    return titles.map(() => ({
      topic: "other" as ArticleTopic,
      sentiment: "neutral" as ArticleSentiment,
    }));
  const result = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = result.choices?.[0]?.message?.content ?? "{}";
  try {
    const parsed = JSON.parse(content) as {
      results?: { topic: ArticleTopic; sentiment: ArticleSentiment }[];
    };
    return (
      parsed.results ??
      titles.map(() => ({
        topic: "other" as ArticleTopic,
        sentiment: "neutral" as ArticleSentiment,
      }))
    );
  } catch {
    return titles.map(() => ({
      topic: "other" as ArticleTopic,
      sentiment: "neutral" as ArticleSentiment,
    }));
  }
}

export const runPrNewsCoverage: ModuleRunner = async ({
  userId,
  entity,
  run,
}) => {
  const { login, password } = getDataForSeoCredentials("pr_news_coverage");
  const apiKey = requireEnv("OPENROUTER_API_KEY", "pr_news_coverage");
  const brand = getBrand(entity);
  const credentials = Buffer.from(`${login}:${password}`).toString("base64");

  const rawArticles = await fetchNewsArticles(brand, credentials);
  const titles = rawArticles.map((a) => a.title ?? "").filter(Boolean);
  const classifications = await classifyArticles(titles, apiKey);

  const articles = rawArticles.map((a, i) => ({
    title: a.title ?? "",
    url: a.url ?? "",
    domain: a.domain ?? "",
    publishedAt: a.timestamp ?? null,
    topic: classifications[i]?.topic ?? "other",
    sentiment: classifications[i]?.sentiment ?? "neutral",
  }));

  const topicBreakdown: Record<string, number> = {};
  let positive = 0;
  let neutral = 0;
  let negative = 0;

  for (const a of articles) {
    topicBreakdown[a.topic] = (topicBreakdown[a.topic] ?? 0) + 1;
    if (a.sentiment === "positive") positive++;
    else if (a.sentiment === "negative") negative++;
    else neutral++;
  }

  const prev = await signalSnapshotRepo.findLatest(
    entity.id,
    "pr_news_coverage",
  );
  const signals: NewSignal[] = [];
  const dedupKey = `pr_news_coverage:${entity.id}`;
  const capturedDate = new Date().toISOString().slice(0, 10);

  if (!prev) {
    signals.push({
      userId,
      subjectEntityId: entity.id,
      capabilityKey: "pr_news_coverage",
      severity: "p3",
      title: `${brand} news coverage baseline: ${articles.length} articles`,
      summary: `Sentiment: ${positive} positive, ${neutral} neutral, ${negative} negative in last 30 days.`,
      evidence: {
        sourceUrl: `https://www.google.com/search?q=${encodeURIComponent(brand)}&tbm=nws`,
        runId: run.id,
        details: {
          baseline: true,
          articleCount: articles.length,
          topicBreakdown,
          sentimentBreakdown: { positive, neutral, negative },
        },
      },
      confidence: "0.75",
      dedupKey,
    });
  } else {
    const maArticles = articles.filter((a) => a.topic === "funding");
    if (maArticles.length > 0) {
      signals.push({
        userId,
        subjectEntityId: entity.id,
        capabilityKey: "pr_news_coverage",
        severity: "p1",
        title: `${brand} M&A/funding coverage detected: ${maArticles.length} article${maArticles.length !== 1 ? "s" : ""}`,
        summary: maArticles[0]?.title ?? `${brand} funding or M&A news found.`,
        evidence: {
          sourceUrl: maArticles[0]?.url ?? `https://${entity.domain}`,
          runId: run.id,
          details: { articles: maArticles.slice(0, 3) },
        },
        confidence: "0.8",
        dedupKey: `${dedupKey}:ma:${capturedDate}`,
      });
    }

    if (negative > (positive + neutral) * 0.5 && negative >= 3) {
      signals.push({
        userId,
        subjectEntityId: entity.id,
        capabilityKey: "pr_news_coverage",
        severity: "p2",
        title: `${brand} negative press spike: ${negative} negative articles`,
        summary: `Negative articles outnumber positive+neutral by 2:1 this period.`,
        evidence: {
          sourceUrl: `https://www.google.com/search?q=${encodeURIComponent(brand)}&tbm=nws`,
          runId: run.id,
          details: {
            negative,
            positive,
            neutral,
            negativeArticles: articles
              .filter((a) => a.sentiment === "negative")
              .slice(0, 3),
          },
        },
        confidence: "0.75",
        dedupKey: `${dedupKey}:negative:${capturedDate}`,
      });
    }
  }

  return {
    output: asOutput({
      source: "dataforseo+openrouter",
      brand,
      dataIssues: [],
      newsArticleCount: articles.length,
      articles: articles.slice(0, 20),
      topicBreakdown,
      sentimentBreakdown: { positive, neutral, negative },
    }),
    signals,
    costUnits: 2,
  };
};
