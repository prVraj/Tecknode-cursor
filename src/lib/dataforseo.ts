import { cachedFetch } from "@/lib/intel/fetch-cache";
import {
  dollarsToMicroUsd,
  recordApiUsage,
} from "@/lib/observability/api-usage";

const DATAFORSEO_SERP_URL =
  "https://api.dataforseo.com/v3/serp/google/organic/live/advanced";
const DATAFORSEO_SEARCH_VOLUME_URL =
  "https://api.dataforseo.com/v3/keywords_data/google/search_volume/live";
const DATAFORSEO_RANKED_KEYWORDS_URL =
  "https://api.dataforseo.com/v3/dataforseo_labs/google/ranked_keywords/live";
const DATAFORSEO_DOMAIN_OVERVIEW_URL =
  "https://api.dataforseo.com/v3/dataforseo_labs/google/domain_rank_overview/live";
const DATAFORSEO_HISTORICAL_OVERVIEW_URL =
  "https://api.dataforseo.com/v3/dataforseo_labs/google/historical_rank_overview/live";
const DATAFORSEO_AI_SEARCH_VOLUME_URL =
  "https://api.dataforseo.com/v3/ai_optimization/ai_keyword_data/keywords_search_volume/live";
// domain_pages endpoint is not available on all DataForSEO plans;
// top pages are derived from ranked_keywords grouped by URL instead.

export type OrganicResult = {
  position: number;
  title: string;
  link: string;
  domain: string;
  snippet: string;
};

export type FeaturedSnippet = {
  title: string;
  snippet: string;
  domain: string;
  link: string;
};

export type AiOverview = {
  detected: boolean;
  textContent: string;
  references: Array<{
    domain: string;
    link: string;
    title: string;
  }>;
};

export type ExtractedSerpData = {
  organic: OrganicResult[];
  featuredSnippet: FeaturedSnippet | null;
  aiOverview: AiOverview;
  peopleAlsoAsk: Array<{
    question: string;
    snippet: string;
    link: string;
  }>;
  relatedSearches: Array<{
    query: string;
  }>;
};

export type KeywordMetrics = {
  searchVolume: number | null;
  cpc: number | null;
  competition: number | null;
  monthlySearches: Array<{
    year: number;
    month: number;
    searchVolume: number;
  }>;
};

export type AuthoritySummary = {
  rank: number | null;
  backlinks: number | null;
  referringDomains: number | null;
  spamScore: number | null;
  brokenBacklinks: number | null;
  crawledPages: number | null;
};

export type PublicFileStatus = {
  present: boolean;
  url: string;
  status: number | null;
  contentLength: number | null;
};

export type PublicFilesSummary = {
  llmsTxt: PublicFileStatus;
  llmsFullTxt: PublicFileStatus;
  robotsTxt: PublicFileStatus;
  sitemapXml: PublicFileStatus;
};

export type OnPagePublicSummary = {
  url: string;
  status: number | null;
  title: string | null;
  metaDescription: string | null;
  hasStructuredData: boolean;
  schemaTypes: string[];
  contentFreshness: string | null;
};

export type DataForSeoSeoGeoResponse = {
  keyword: string;
  trackedDomain: string;
  source: "dataforseo";
  version: "direct";
  dataIssues: string[];
  keywordMetrics: KeywordMetrics;
  authority: AuthoritySummary;
  publicFiles: PublicFilesSummary;
  onPage: OnPagePublicSummary;
  serp: ExtractedSerpData;
  seo: {
    yourRank: number | null;
    topCompetitors: Array<{
      domain: string;
      position: number;
      title: string;
    }>;
    featuredSnippetOwner: string | null;
    youOwnFeaturedSnippet: boolean;
    contentGaps: string[];
  };
  geo: {
    aiOverviewPresent: boolean;
    brandMentionedInAiOverview: boolean;
    citedSources: string[];
  };
  publicDataCoverage: {
    currentlyReturned: string[];
    availableWithPlatformKeys: {
      dataForSeo: string[];
      publicCrawlerDns: string[];
    };
    notReturnedYet: string[];
  };
};

type DataForSeoTask = {
  status_code?: unknown;
  status_message?: unknown;
  cost?: unknown;
  result?: unknown;
};

type DataForSeoResponse = {
  status_code?: unknown;
  status_message?: unknown;
  tasks?: unknown;
};

export class DataForSeoApiError extends Error {
  readonly provider = "dataforseo" as const;
  constructor(message: string) {
    super(message);
    this.name = "DataForSeoApiError";
  }
}

export const mockDataForSeoSerpResult = {
  items: [
    {
      type: "organic",
      rank_group: 1,
      title: "Best AI Agent Platforms for SaaS Teams",
      url: "https://competitorhq.com/ai-agent-platforms",
      description:
        "A comparison of AI agent platforms for marketing, sales, and operations teams.",
    },
    {
      type: "organic",
      rank_group: 2,
      title: "RunAgents - AI Agents for Marketing Intelligence",
      url: "https://runagents.io/",
      description:
        "RunAgents helps indie founders track competitors, SEO changes, and marketing opportunities.",
    },
    {
      type: "featured_snippet",
      title: "What is an AI agent platform?",
      url: "https://competitorhq.com/ai-agent-platforms",
      description:
        "An AI agent platform helps teams create agents that can complete workflows, research tasks, and operational actions.",
    },
    {
      type: "ai_overview",
      text: "AI agent platforms automate multi-step work such as research, reporting, customer support, and marketing operations.",
      references: [
        {
          title: "CompetitorHQ guide",
          url: "https://competitorhq.com/ai-agent-platforms",
        },
        {
          title: "RunAgents",
          url: "https://runagents.io/",
        },
      ],
    },
    {
      type: "people_also_ask",
      title: "What is an AI agent platform?",
      description:
        "It is software for creating AI agents that can reason through and execute tasks.",
      url: "https://competitorhq.com/learn/ai-agent-platform",
    },
    {
      type: "people_also_ask",
      title: "Which AI agent platform is best for marketing teams?",
      description:
        "Marketing teams should compare integrations, reporting workflows, and competitive intelligence features.",
      url: "https://workflowops.ai/marketing-ai-agents",
    },
    { type: "related_searches", title: "best ai agent platform" },
    { type: "related_searches", title: "ai agents for marketing teams" },
  ],
};

export const seoGeoPublicDataCoverage = {
  currentlyReturned: [
    "Keyword rank position",
    "Top competitors in SERP",
    "Featured snippet owner",
    "People Also Ask content gaps",
    "Related searches",
    "Search volume",
    "Keyword CPC",
    "Keyword competition",
    "Monthly search volume trend",
    "llms.txt / llms-full.txt audit",
    "robots.txt / sitemap.xml checks",
    "Homepage schema/structured data checks",
    "Homepage title and meta description",
    "Homepage content freshness signal when available",
    "AI Overview detection when returned by DataForSEO SERP",
    "AI Overview cited sources when returned by DataForSEO SERP",
    "Brand/domain mention in AI Overview when returned by DataForSEO SERP",
  ],
  availableWithPlatformKeys: {
    dataForSeo: [
      "LLM/AI citation tracking",
      "Per-keyword AI mentions",
      "Competitor AI citations",
      "AI response text",
      "AI sentiment, if provided by the API",
      "Citation URLs/domains",
      "SERP feature tracking",
      "Search volume",
      "Ranked keywords",
      "Competitor top pages",
      "Domain traffic estimates",
      "Backlinks",
      "On-page/schema crawl",
    ],
    publicCrawlerDns: [
      "llms.txt / llms-full.txt audit",
      "robots.txt / sitemap.xml checks",
      "schema/structured data checks",
      "content freshness",
      "MTA-STS",
      "TLS-RPT",
      "SPF lookup count",
      "PTR/reverse DNS",
      "public blacklist monitoring",
    ],
  },
  notReturnedYet: [
    "LLM/AI citation tracking",
    "Per-keyword AI mentions",
    "Competitor AI citations",
    "AI response text",
    "AI sentiment",
    "Citation URLs/domains outside Google SERP AI Overview",
    "Full SERP feature tracking",
    "Ranked keywords",
    "Competitor top pages",
    "Domain traffic estimates",
    "Backlinks",
    "Backlink authority summary",
    "MTA-STS",
    "TLS-RPT",
    "SPF lookup count",
    "PTR/reverse DNS",
    "public blacklist monitoring",
  ],
};

function stringOrEmpty(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function recordOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function arrayOrEmpty(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function firstRecordOrNull(value: unknown): Record<string, unknown> | null {
  return recordOrNull(arrayOrEmpty(value)[0]);
}

function domainFromUrl(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) return "";

  try {
    const url = new URL(value);
    return url.hostname.replace(/^www\./i, "");
  } catch {
    return value
      .replace(/^https?:\/\//i, "")
      .replace(/^www\./i, "")
      .split("/")[0];
  }
}

function normalizeDomainValue(value: unknown): string {
  return domainFromUrl(value).replace(/^www\./i, "");
}

function normalizeDomain(value: string): string {
  return normalizeDomainValue(
    /^https?:\/\//i.test(value) ? value : `https://${value}`,
  );
}

function publicUrlForDomain(domain: string, path = "/"): string {
  return `https://${normalizeDomain(domain)}${path}`;
}

function domainsMatch(a: string, b: string): boolean {
  const left = normalizeDomain(a);
  const right = normalizeDomain(b);
  return (
    left === right || left.endsWith(`.${right}`) || right.endsWith(`.${left}`)
  );
}

export function getDataForSeoMissingEnvKeys({
  login,
  password,
  useMockData,
}: {
  login?: string;
  password?: string;
  useMockData: boolean;
}): string[] {
  const missing: string[] = [];
  if (!(useMockData || login)) missing.push("DATAFORSEO_LOGIN");
  if (!(useMockData || password)) missing.push("DATAFORSEO_PASSWORD");
  return missing;
}

export function getDataForSeoLocationCode(location?: string): number {
  const normalized = location?.trim().toLowerCase();
  if (normalized === "in" || normalized === "india") return 2356;
  if (
    normalized === "gb" ||
    normalized === "uk" ||
    normalized === "united kingdom"
  )
    return 2826;
  return 2840;
}

function dataForSeoAuthHeaders(login: string, password: string) {
  return {
    Authorization: `Basic ${Buffer.from(`${login}:${password}`).toString("base64")}`,
    "Content-Type": "application/json",
  };
}

/** Stash usage telemetry for a DataForSEO request. Fire-and-forget. */
async function recordDataForSeoUsage(
  operation: string,
  startedAt: number,
  result: {
    httpStatus?: number;
    taskCostUsd?: number;
    status: "success" | "error";
    errorCode?: string;
  },
) {
  await recordApiUsage({
    provider: "dataforseo",
    operation,
    unitType: "task",
    units: result.status === "success" ? 1 : 0,
    costMicroUsd: dollarsToMicroUsd(result.taskCostUsd ?? 0),
    costSource: result.taskCostUsd != null ? "body" : "unknown",
    status: result.status,
    httpStatus: result.httpStatus,
    errorCode: result.errorCode,
    durationMs: Date.now() - startedAt,
  });
}

async function postDataForSeoLive({
  url,
  body,
  login,
  password,
}: {
  url: string;
  body: unknown;
  login?: string;
  password?: string;
}): Promise<unknown> {
  if (!(login && password)) {
    throw new DataForSeoApiError("DataForSEO credentials are not configured");
  }

  // Operation = URL path so the dashboard can group by endpoint without the
  // host noise. e.g. "/v3/serp/google/organic/live/advanced".
  const operation = url.replace(/^https?:\/\/[^/]+/, "") || url;
  const startedAt = Date.now();
  const response = await fetch(url, {
    method: "POST",
    headers: dataForSeoAuthHeaders(login, password),
    body: JSON.stringify(body),
  }).catch(async (err) => {
    await recordDataForSeoUsage(operation, startedAt, {
      status: "error",
      errorCode: "FETCH_FAILED",
    });
    throw err;
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    await recordDataForSeoUsage(operation, startedAt, {
      status: "error",
      httpStatus: response.status,
    });
    throw new DataForSeoApiError(
      `DataForSEO ${response.status}: ${text || response.statusText}`,
    );
  }

  const json = (await response.json()) as DataForSeoResponse;
  const task = arrayOrEmpty(json.tasks)[0] as DataForSeoTask | undefined;
  // Task-level `cost` is authoritative in USD even when the envelope is OK
  // but the task itself errored. Charge it either way.
  const taskCostUsd = typeof task?.cost === "number" ? task.cost : 0;
  const envelopeFailed = json.status_code !== 20000;
  const taskFailed = !!(task?.status_code && task.status_code !== 20000);
  let errorCode: string | undefined;
  if (envelopeFailed) errorCode = `STATUS_${json.status_code}`;
  else if (taskFailed) errorCode = `TASK_${task?.status_code}`;

  await recordDataForSeoUsage(operation, startedAt, {
    httpStatus: response.status,
    taskCostUsd,
    status: envelopeFailed || taskFailed ? "error" : "success",
    errorCode,
  });

  if (envelopeFailed) {
    throw new DataForSeoApiError(
      `DataForSEO error: ${stringOrEmpty(json.status_message) || "Unknown error"}`,
    );
  }
  if (taskFailed) {
    throw new DataForSeoApiError(
      `DataForSEO task error: ${
        stringOrEmpty(task?.status_message) || "Unknown task error"
      }`,
    );
  }

  return task?.result;
}

function extractDataForSeoItems(result: unknown): unknown[] {
  if (Array.isArray(result)) {
    return result.flatMap((entry) => extractDataForSeoItems(entry));
  }

  const record = recordOrNull(result);
  if (!record) return [];

  const items = record.items;
  if (Array.isArray(items)) return items;

  return [];
}

export function extractDataForSeoSerpData(result: unknown): ExtractedSerpData {
  const items = extractDataForSeoItems(result);

  const organic = items
    .map((item) => {
      const record = recordOrNull(item);
      if (!record || record.type !== "organic") return null;

      const link = stringOrEmpty(record.url);
      const position =
        numberOrNull(record.rank_group) ?? numberOrNull(record.rank_absolute);
      if (!link || position === null) return null;

      return {
        position,
        title: stringOrEmpty(record.title),
        link,
        domain: normalizeDomainValue(link),
        snippet: stringOrEmpty(record.description),
      };
    })
    .filter((item): item is OrganicResult => item !== null);

  const featuredSnippetItem = items
    .map(recordOrNull)
    .find(
      (item) =>
        item?.type === "featured_snippet" || item?.type === "answer_box",
    );
  const featuredSnippet = featuredSnippetItem
    ? {
        title: stringOrEmpty(featuredSnippetItem.title),
        snippet: stringOrEmpty(featuredSnippetItem.description),
        domain: normalizeDomainValue(featuredSnippetItem.url),
        link: stringOrEmpty(featuredSnippetItem.url),
      }
    : null;

  const aiOverviewItem = items
    .map(recordOrNull)
    .find((item) => item?.type === "ai_overview");
  const aiReferences = arrayOrEmpty(aiOverviewItem?.references)
    .map((reference) => {
      const record = recordOrNull(reference);
      const link = stringOrEmpty(record?.url) || stringOrEmpty(record?.link);
      return {
        domain:
          normalizeDomainValue(record?.domain) || normalizeDomainValue(link),
        link,
        title: stringOrEmpty(record?.title),
      };
    })
    .filter(
      (reference) => reference.domain || reference.link || reference.title,
    );
  const aiText =
    stringOrEmpty(aiOverviewItem?.text) ||
    stringOrEmpty(aiOverviewItem?.description) ||
    stringOrEmpty(aiOverviewItem?.content);

  const peopleAlsoAsk = items
    .map(recordOrNull)
    .filter((item) => item?.type === "people_also_ask")
    .map((item) => ({
      question: stringOrEmpty(item?.title),
      snippet: stringOrEmpty(item?.description),
      link: stringOrEmpty(item?.url),
    }))
    .filter((item) => item.question || item.snippet || item.link);

  const relatedSearches = items
    .map(recordOrNull)
    .filter(
      (item) =>
        item?.type === "related_searches" || item?.type === "related_search",
    )
    .map((item) => ({
      query: stringOrEmpty(item?.title) || stringOrEmpty(item?.keyword),
    }))
    .filter((item) => item.query);

  return {
    organic,
    featuredSnippet,
    aiOverview: {
      detected: Boolean(aiOverviewItem),
      textContent: aiText,
      references: aiReferences,
    },
    peopleAlsoAsk,
    relatedSearches,
  };
}

export function emptyKeywordMetrics(): KeywordMetrics {
  return {
    searchVolume: null,
    cpc: null,
    competition: null,
    monthlySearches: [],
  };
}

export function extractDataForSeoKeywordMetrics(
  result: unknown,
): KeywordMetrics {
  const record = firstRecordOrNull(result);
  if (!record) return emptyKeywordMetrics();

  return {
    searchVolume: numberOrNull(record.search_volume),
    cpc: numberOrNull(record.cpc),
    competition: numberOrNull(record.competition),
    monthlySearches: arrayOrEmpty(record.monthly_searches)
      .map(recordOrNull)
      .map((item) => {
        const year = numberOrNull(item?.year);
        const month = numberOrNull(item?.month);
        const searchVolume = numberOrNull(item?.search_volume);
        if (year === null || month === null || searchVolume === null) {
          return null;
        }

        return { year, month, searchVolume };
      })
      .filter((item): item is KeywordMetrics["monthlySearches"][number] =>
        Boolean(item),
      ),
  };
}

export function emptyAuthoritySummary(): AuthoritySummary {
  return {
    rank: null,
    backlinks: null,
    referringDomains: null,
    spamScore: null,
    brokenBacklinks: null,
    crawledPages: null,
  };
}

export function extractDataForSeoAuthoritySummary(
  result: unknown,
): AuthoritySummary {
  const record = firstRecordOrNull(result);
  if (!record) return emptyAuthoritySummary();

  return {
    rank: numberOrNull(record.rank),
    backlinks: numberOrNull(record.backlinks),
    referringDomains: numberOrNull(record.referring_domains),
    spamScore:
      numberOrNull(record.backlinks_spam_score) ??
      numberOrNull(recordOrNull(record.info)?.target_spam_score),
    brokenBacklinks: numberOrNull(record.broken_backlinks),
    crawledPages: numberOrNull(record.crawled_pages),
  };
}

function emptyPublicFileStatus(domain: string, path: string): PublicFileStatus {
  return {
    present: false,
    url: publicUrlForDomain(domain, path),
    status: null,
    contentLength: null,
  };
}

export function emptyPublicFilesSummary(domain: string): PublicFilesSummary {
  return {
    llmsTxt: emptyPublicFileStatus(domain, "/llms.txt"),
    llmsFullTxt: emptyPublicFileStatus(domain, "/llms-full.txt"),
    robotsTxt: emptyPublicFileStatus(domain, "/robots.txt"),
    sitemapXml: emptyPublicFileStatus(domain, "/sitemap.xml"),
  };
}

async function fetchPublicFileStatus(
  domain: string,
  path: string,
): Promise<PublicFileStatus> {
  const url = publicUrlForDomain(domain, path);

  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
    });
    const text = response.ok ? await response.text() : "";

    return {
      present: response.ok,
      url,
      status: response.status,
      contentLength: text.length || null,
    };
  } catch {
    return {
      present: false,
      url,
      status: null,
      contentLength: null,
    };
  }
}

export async function fetchPublicFilesSummary(
  domain: string,
): Promise<PublicFilesSummary> {
  const [llmsTxt, llmsFullTxt, robotsTxt, sitemapXml] = await Promise.all([
    fetchPublicFileStatus(domain, "/llms.txt"),
    fetchPublicFileStatus(domain, "/llms-full.txt"),
    fetchPublicFileStatus(domain, "/robots.txt"),
    fetchPublicFileStatus(domain, "/sitemap.xml"),
  ]);

  return { llmsTxt, llmsFullTxt, robotsTxt, sitemapXml };
}

export function emptyOnPagePublicSummary(domain: string): OnPagePublicSummary {
  return {
    url: publicUrlForDomain(domain),
    status: null,
    title: null,
    metaDescription: null,
    hasStructuredData: false,
    schemaTypes: [],
    contentFreshness: null,
  };
}

function extractHtmlMatch(html: string, pattern: RegExp): string | null {
  const match = html.match(pattern);
  const value = match?.[1]?.trim();
  return value || null;
}

function addSchemaType(types: Set<string>, value: unknown) {
  if (typeof value === "string") {
    types.add(value);
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === "string") types.add(item);
    }
  }
}

function collectJsonLdTypes(types: Set<string>, value: unknown) {
  const record = recordOrNull(value);
  if (!record) return;

  const graph = arrayOrEmpty(record["@graph"]);
  const candidates = graph.length > 0 ? graph : [record];
  for (const candidate of candidates) {
    addSchemaType(types, recordOrNull(candidate)?.["@type"]);
  }
}

function parseJsonLdRecords(json: string): unknown[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

function extractJsonLdTypes(html: string): string[] {
  const scriptPattern =
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  const types = new Set<string>();

  for (const match of html.matchAll(scriptPattern)) {
    for (const record of parseJsonLdRecords(match[1] ?? "")) {
      collectJsonLdTypes(types, record);
    }
  }

  return Array.from(types);
}

export async function fetchOnPagePublicSummary(
  domain: string,
): Promise<OnPagePublicSummary> {
  const url = publicUrlForDomain(domain);

  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
    });
    const html = response.ok ? await response.text() : "";
    const schemaTypes = extractJsonLdTypes(html);

    return {
      url,
      status: response.status,
      title: extractHtmlMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i),
      metaDescription: extractHtmlMatch(
        html,
        /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["'][^>]*>/i,
      ),
      hasStructuredData: schemaTypes.length > 0,
      schemaTypes,
      contentFreshness:
        extractHtmlMatch(
          html,
          /<meta[^>]+property=["']article:modified_time["'][^>]+content=["']([^"']*)["'][^>]*>/i,
        ) ??
        extractHtmlMatch(html, /<time[^>]+datetime=["']([^"']*)["'][^>]*>/i),
    };
  } catch {
    return emptyOnPagePublicSummary(domain);
  }
}

export function buildDataForSeoSeoGeoResponse({
  keyword,
  domain,
  serp,
  keywordMetrics = emptyKeywordMetrics(),
  authority = emptyAuthoritySummary(),
  publicFiles = emptyPublicFilesSummary(domain),
  onPage = emptyOnPagePublicSummary(domain),
  dataIssues = [],
}: {
  keyword: string;
  domain: string;
  serp: ExtractedSerpData;
  keywordMetrics?: KeywordMetrics;
  authority?: AuthoritySummary;
  publicFiles?: PublicFilesSummary;
  onPage?: OnPagePublicSummary;
  dataIssues?: string[];
}): DataForSeoSeoGeoResponse {
  const yourResult = serp.organic.find((result) =>
    domainsMatch(result.domain, domain),
  );
  const yourRank = yourResult?.position ?? null;
  const topCompetitors = serp.organic
    .filter((result) => !domainsMatch(result.domain, domain))
    .filter((result) => yourRank === null || result.position < yourRank)
    .slice(0, 3)
    .map((result) => ({
      domain: result.domain,
      position: result.position,
      title: result.title,
    }));
  const featuredSnippetOwner = serp.featuredSnippet?.domain || null;
  const citedSources = Array.from(
    new Set(
      serp.aiOverview.references
        .map((reference) => normalizeDomainValue(reference.domain))
        .filter(Boolean),
    ),
  ).slice(0, 3);

  return {
    keyword,
    trackedDomain: domain,
    source: "dataforseo",
    version: "direct",
    dataIssues,
    keywordMetrics,
    authority,
    publicFiles,
    onPage,
    serp,
    seo: {
      yourRank,
      topCompetitors,
      featuredSnippetOwner,
      youOwnFeaturedSnippet: featuredSnippetOwner
        ? domainsMatch(featuredSnippetOwner, domain)
        : false,
      contentGaps: serp.peopleAlsoAsk
        .filter(
          (item) => !domainsMatch(normalizeDomainValue(item.link), domain),
        )
        .map((item) => item.question)
        .filter(Boolean)
        .slice(0, 3),
    },
    geo: {
      aiOverviewPresent: serp.aiOverview.detected,
      brandMentionedInAiOverview:
        serp.aiOverview.textContent
          .toLowerCase()
          .includes(domain.toLowerCase()) ||
        serp.aiOverview.references.some((reference) =>
          domainsMatch(reference.domain, domain),
        ),
      citedSources,
    },
    publicDataCoverage: seoGeoPublicDataCoverage,
  };
}

export async function fetchDataForSeoSerp({
  keyword,
  location,
  login,
  password,
}: {
  keyword: string;
  location?: string;
  login?: string;
  password?: string;
}): Promise<unknown> {
  return cachedFetch({
    provider: "dataforseo",
    resource: "serp",
    params: {
      keyword,
      location_code: getDataForSeoLocationCode(location),
      depth: 10,
    },
    fetcher: () =>
      postDataForSeoLive({
        url: DATAFORSEO_SERP_URL,
        login,
        password,
        body: [
          {
            keyword,
            location_code: getDataForSeoLocationCode(location),
            language_code: "en",
            depth: 10,
          },
        ],
      }),
  });
}

export async function fetchDataForSeoSearchVolume({
  keyword,
  location,
  login,
  password,
}: {
  keyword: string;
  location?: string;
  login?: string;
  password?: string;
}): Promise<unknown> {
  return postDataForSeoLive({
    url: DATAFORSEO_SEARCH_VOLUME_URL,
    login,
    password,
    body: [
      {
        keywords: [keyword],
        location_code: getDataForSeoLocationCode(location),
      },
    ],
  });
}

/** Max keywords the AI-search-volume endpoint accepts in one request. */
export const AI_SEARCH_VOLUME_MAX_KEYWORDS = 1000;
const AI_SEARCH_VOLUME_MAX_KEYWORD_LENGTH = 250;

/**
 * AI-search volume (LLM-assistant query demand) for a keyword set.
 *
 * Billing is dominated by a flat ~$0.01 per-request fee, not the documented
 * $0.0001 per keyword (one keyword measured at $0.0101). Always batch the whole
 * keyword set into a single call rather than fanning out per keyword.
 */
export async function fetchDataForSeoAiSearchVolume({
  keywords,
  location,
  login,
  password,
}: {
  keywords: string[];
  location?: string;
  login?: string;
  password?: string;
}): Promise<unknown> {
  return postDataForSeoLive({
    url: DATAFORSEO_AI_SEARCH_VOLUME_URL,
    login,
    password,
    body: [
      {
        keywords: keywords
          .slice(0, AI_SEARCH_VOLUME_MAX_KEYWORDS)
          .map((keyword) =>
            keyword.slice(0, AI_SEARCH_VOLUME_MAX_KEYWORD_LENGTH),
          ),
        location_code: getDataForSeoLocationCode(location),
        language_code: "en",
      },
    ],
  });
}

export type AiSearchVolumeMonth = {
  year: number;
  month: number;
  aiSearchVolume: number | null;
};

export type AiSearchVolumeItem = {
  keyword: string;
  aiSearchVolume: number | null;
  monthlySearches: AiSearchVolumeMonth[];
};

/**
 * Shape (verified against a live call): `task.result` is
 * `[{ location_code, language_code, items_count, items: [...] }]`, so the
 * generic `extractDataForSeoItems` unwrap applies.
 */
export function extractAiSearchVolumeItems(raw: unknown): AiSearchVolumeItem[] {
  return extractDataForSeoItems(raw).flatMap((entry) => {
    const item = recordOrNull(entry);
    if (!item) return [];
    const keyword = stringOrEmpty(item.keyword);
    if (!keyword) return [];

    const monthlySearches = arrayOrEmpty(item.ai_monthly_searches).flatMap(
      (monthEntry) => {
        const month = recordOrNull(monthEntry);
        const year = numberOrNull(month?.year);
        const monthNumber = numberOrNull(month?.month);
        if (month === null || year === null || monthNumber === null) return [];
        return [
          {
            year,
            month: monthNumber,
            aiSearchVolume: numberOrNull(month.ai_search_volume),
          },
        ];
      },
    );

    return [
      {
        keyword,
        aiSearchVolume: numberOrNull(item.ai_search_volume),
        monthlySearches,
      },
    ];
  });
}

export type RankedKeyword = {
  keyword: string;
  position: number;
  searchVolume: number | null;
  cpc: number | null;
  competition: number | null;
  keywordDifficulty: number | null;
  intent: string | null;
  url: string | null;
};

export type KeywordGapResult = {
  keyword: string;
  searchVolume: number | null;
  cpc: number | null;
  competition: number | null;
  keywordDifficulty: number | null;
  intent: string | null;
  yourPosition: number | null;
  competitors: Array<{
    domain: string;
    position: number;
    url: string | null;
  }>;
  opportunityScore: number;
};

export type KeywordGapResponse = {
  trackedDomain: string;
  competitors: string[];
  source: "dataforseo";
  location: string;
  totalGaps: number;
  gaps: KeywordGapResult[];
  yourRankedCount: number;
  dataIssues: string[];
};

export function extractRankedKeywords(result: unknown): RankedKeyword[] {
  const items = extractDataForSeoItems(result);

  return items
    .map((item) => {
      const record = recordOrNull(item);
      if (!record) return null;

      const keywordData = recordOrNull(record.keyword_data);
      const serpElement = recordOrNull(record.ranked_serp_element);
      const serpItem = recordOrNull(serpElement?.serp_item);
      const keywordInfo = recordOrNull(keywordData?.keyword_info);

      const keyword =
        stringOrEmpty(keywordData?.keyword) || stringOrEmpty(record.keyword);
      if (!keyword) return null;

      const position =
        numberOrNull(serpItem?.rank_group) ??
        numberOrNull(serpItem?.rank_absolute) ??
        numberOrNull(record.rank_group);
      if (position === null) return null;

      const intentValue =
        stringOrEmpty(
          recordOrNull(keywordData?.search_intent_info)?.main_intent,
        ) || null;

      return {
        keyword,
        position,
        searchVolume: numberOrNull(keywordInfo?.search_volume),
        cpc: numberOrNull(keywordInfo?.cpc),
        competition: numberOrNull(keywordInfo?.competition),
        keywordDifficulty: numberOrNull(keywordData?.keyword_difficulty),
        intent: intentValue,
        url: stringOrEmpty(serpItem?.url) || stringOrEmpty(record.url) || null,
      } satisfies RankedKeyword;
    })
    .filter((item): item is RankedKeyword => item !== null);
}

export async function fetchDataForSeoRankedKeywords({
  domain,
  location,
  login,
  password,
  limit = 350,
}: {
  domain: string;
  location?: string;
  login?: string;
  password?: string;
  limit?: number;
}): Promise<unknown> {
  return cachedFetch({
    provider: "dataforseo",
    resource: "ranked_keywords",
    params: {
      domain: normalizeDomain(domain),
      location_code: getDataForSeoLocationCode(location),
      limit,
    },
    fetcher: () =>
      postDataForSeoLive({
        url: DATAFORSEO_RANKED_KEYWORDS_URL,
        login,
        password,
        body: [
          {
            target: normalizeDomain(domain),
            location_code: getDataForSeoLocationCode(location),
            language_code: "en",
            limit,
            filters: [["ranked_serp_element.serp_item.rank_group", "<=", 100]],
          },
        ],
      }),
  });
}

function computeOpportunityScore(
  searchVolume: number | null,
  keywordDifficulty: number | null,
  bestCompetitorPosition: number,
): number {
  const volume = searchVolume ?? 0;
  const kd = keywordDifficulty ?? 50;
  const positionBonus = bestCompetitorPosition <= 3 ? 1.3 : 1.0;
  return Math.round((volume / Math.max(kd, 1)) * positionBonus);
}

function collectAllCompetitorKeywords(
  maps: Map<string, RankedKeyword>[],
): Set<string> {
  const all = new Set<string>();
  for (const map of maps) {
    for (const kw of map.keys()) {
      all.add(kw);
    }
  }
  return all;
}

function buildGapEntry({
  keyword,
  yourPosition,
  competitorDomains,
  competitorKeywordMaps,
  minVolume,
  maxKD,
}: {
  keyword: string;
  yourPosition: number | null;
  competitorDomains: string[];
  competitorKeywordMaps: Map<string, RankedKeyword>[];
  minVolume: number;
  maxKD: number;
}): KeywordGapResult | null {
  const competitorEntries = competitorDomains
    .map((d, i) => {
      const entry = competitorKeywordMaps[i]?.get(keyword);
      if (!entry || entry.position > 10) return null;
      return { domain: d, position: entry.position, url: entry.url };
    })
    .filter((e): e is NonNullable<typeof e> => e !== null);

  if (competitorEntries.length === 0) return null;

  const anyEntry = competitorKeywordMaps
    .map((m) => m.get(keyword))
    .find(Boolean);
  const searchVolume = anyEntry?.searchVolume ?? null;
  const kd = anyEntry?.keywordDifficulty ?? null;

  if (searchVolume !== null && searchVolume < minVolume) return null;
  if (kd !== null && kd > maxKD) return null;

  const bestPosition = Math.min(...competitorEntries.map((e) => e.position));

  return {
    keyword: anyEntry?.keyword ?? keyword,
    searchVolume,
    cpc: anyEntry?.cpc ?? null,
    competition: anyEntry?.competition ?? null,
    keywordDifficulty: kd,
    intent: anyEntry?.intent ?? null,
    yourPosition,
    competitors: competitorEntries.sort((a, b) => a.position - b.position),
    opportunityScore: computeOpportunityScore(searchVolume, kd, bestPosition),
  };
}

export function buildKeywordGapResponse({
  domain,
  competitorDomains,
  yourKeywords,
  competitorKeywordMaps,
  location,
  minVolume,
  maxKD,
  dataIssues,
}: {
  domain: string;
  competitorDomains: string[];
  yourKeywords: RankedKeyword[];
  competitorKeywordMaps: Map<string, RankedKeyword>[];
  location: string;
  minVolume: number;
  maxKD: number;
  dataIssues: string[];
}): KeywordGapResponse {
  const yourMap = new Map<string, RankedKeyword>(
    yourKeywords.map((kw) => [kw.keyword.toLowerCase(), kw]),
  );
  const allCompetitorKeywords = collectAllCompetitorKeywords(
    competitorKeywordMaps,
  );

  const gaps: KeywordGapResult[] = [];

  for (const keyword of allCompetitorKeywords) {
    const yourPosition = yourMap.get(keyword)?.position ?? null;
    if (yourPosition !== null && yourPosition <= 10) continue;

    const entry = buildGapEntry({
      keyword,
      yourPosition,
      competitorDomains,
      competitorKeywordMaps,
      minVolume,
      maxKD,
    });
    if (entry) gaps.push(entry);
  }

  gaps.sort((a, b) => b.opportunityScore - a.opportunityScore);

  return {
    trackedDomain: normalizeDomain(domain),
    competitors: competitorDomains.map(normalizeDomain),
    source: "dataforseo",
    location,
    totalGaps: gaps.length,
    gaps: gaps.slice(0, 100),
    yourRankedCount: yourKeywords.length,
    dataIssues,
  };
}

// ─── Traffic Trend ────────────────────────────────────────────────────────────

export type MonthlyTrafficPoint = {
  year: number;
  month: number;
  organicTraffic: number | null;
  paidTraffic: number | null;
  organicKeywords: number | null;
};

export type CompetitorTrafficSummary = {
  domain: string;
  currentOrganicTraffic: number | null;
  currentOrganicKeywords: number | null;
  momChange: number | null;
  trend: "growing" | "declining" | "stable" | "unknown";
  alert: boolean;
  history: MonthlyTrafficPoint[];
  dataIssue?: string;
};

export type TrafficTrendResponse = {
  competitors: CompetitorTrafficSummary[];
  source: "dataforseo";
  location: string;
  alertThresholdPercent: number;
  dataIssues: string[];
};

export async function fetchDataForSeoDomainOverview({
  domain,
  location,
  login,
  password,
}: {
  domain: string;
  location?: string;
  login?: string;
  password?: string;
}): Promise<unknown> {
  return cachedFetch({
    provider: "dataforseo",
    resource: "domain_overview",
    params: {
      domain: normalizeDomain(domain),
      location_code: getDataForSeoLocationCode(location),
    },
    fetcher: () =>
      postDataForSeoLive({
        url: DATAFORSEO_DOMAIN_OVERVIEW_URL,
        login,
        password,
        body: [
          {
            target: normalizeDomain(domain),
            location_code: getDataForSeoLocationCode(location),
            language_code: "en",
          },
        ],
      }),
  });
}

export async function fetchDataForSeoHistoricalOverview({
  domain,
  location,
  login,
  password,
}: {
  domain: string;
  location?: string;
  login?: string;
  password?: string;
}): Promise<unknown> {
  // historical_rank_overview is DataForSEO Labs' most expensive endpoint we
  // call — $0.106/request vs $0.0006 for plain SERP. seo_traffic_trend fans
  // out across (N entities × N-1 competitors) per cycle, so without caching
  // the cost grows N². The sibling `fetchDataForSeoDomainOverview` was already
  // cached; this just brings parity. cachedFetch's day-bucket key + in-flight
  // single-flight + Redis cross-org sharing collapses identical (domain,
  // location) requests to one upstream call per UTC day.
  return cachedFetch({
    provider: "dataforseo",
    resource: "historical_rank_overview",
    params: {
      domain: normalizeDomain(domain),
      location_code: getDataForSeoLocationCode(location),
    },
    fetcher: () =>
      postDataForSeoLive({
        url: DATAFORSEO_HISTORICAL_OVERVIEW_URL,
        login,
        password,
        body: [
          {
            target: normalizeDomain(domain),
            location_code: getDataForSeoLocationCode(location),
            language_code: "en",
          },
        ],
      }),
  });
}

function extractDomainOverviewMetrics(result: unknown): {
  organicTraffic: number | null;
  organicKeywords: number | null;
} {
  const items = extractDataForSeoItems(result);
  const record = recordOrNull(items[0]);
  if (!record) return { organicTraffic: null, organicKeywords: null };

  const metrics = recordOrNull(record.metrics);
  const organic = recordOrNull(metrics?.organic);

  return {
    organicTraffic:
      numberOrNull(organic?.etv) ?? numberOrNull(record.organic_etv),
    organicKeywords:
      numberOrNull(organic?.count) ?? numberOrNull(record.organic_count),
  };
}

function extractHistoricalTrafficPoints(
  result: unknown,
): MonthlyTrafficPoint[] {
  const items = extractDataForSeoItems(result);

  return items
    .map((item) => {
      const record = recordOrNull(item);
      if (!record) return null;

      const year = numberOrNull(record.year);
      const month = numberOrNull(record.month);
      if (year === null || month === null) return null;

      const metrics = recordOrNull(record.metrics);
      const organic = recordOrNull(metrics?.organic);
      const paid = recordOrNull(metrics?.paid);

      return {
        year,
        month,
        organicTraffic: numberOrNull(organic?.etv),
        paidTraffic: numberOrNull(paid?.etv),
        organicKeywords: numberOrNull(organic?.count),
      } satisfies MonthlyTrafficPoint;
    })
    .filter((p): p is MonthlyTrafficPoint => p !== null)
    .sort((a, b) => (a.year !== b.year ? a.year - b.year : a.month - b.month));
}

function computeMomChange(history: MonthlyTrafficPoint[]): number | null {
  if (history.length < 2) return null;
  const prev = history[history.length - 2]?.organicTraffic;
  const curr = history[history.length - 1]?.organicTraffic;
  if (
    prev === null ||
    prev === undefined ||
    curr === null ||
    curr === undefined ||
    prev === 0
  )
    return null;
  return Math.round(((curr - prev) / prev) * 1000) / 10;
}

function classifyTrend(
  momChange: number | null,
): CompetitorTrafficSummary["trend"] {
  if (momChange === null) return "unknown";
  if (momChange >= 5) return "growing";
  if (momChange <= -5) return "declining";
  return "stable";
}

export function buildTrafficTrendResponse({
  competitorDomains,
  overviewResults,
  historicalResults,
  location,
  alertThresholdPercent,
  dataIssues,
}: {
  competitorDomains: string[];
  overviewResults: PromiseSettledResult<unknown>[];
  historicalResults: PromiseSettledResult<unknown>[];
  location: string;
  alertThresholdPercent: number;
  dataIssues: string[];
}): TrafficTrendResponse {
  const competitors: CompetitorTrafficSummary[] = competitorDomains.map(
    (domain, i) => {
      const overviewResult = overviewResults[i];
      const historicalResult = historicalResults[i];

      if (overviewResult?.status === "rejected") {
        const msg =
          overviewResult.reason instanceof Error
            ? overviewResult.reason.message
            : "Unknown error";
        dataIssues.push(`${domain} overview unavailable: ${msg}`);
        return {
          domain: normalizeDomain(domain),
          currentOrganicTraffic: null,
          currentOrganicKeywords: null,
          momChange: null,
          trend: "unknown" as const,
          alert: false,
          history: [],
          dataIssue: msg,
        };
      }

      const { organicTraffic, organicKeywords } = extractDomainOverviewMetrics(
        overviewResult?.value,
      );

      const history =
        historicalResult?.status === "fulfilled"
          ? extractHistoricalTrafficPoints(historicalResult.value)
          : [];

      if (historicalResult?.status === "rejected") {
        const msg =
          historicalResult.reason instanceof Error
            ? historicalResult.reason.message
            : "Unknown error";
        dataIssues.push(`${domain} historical data unavailable: ${msg}`);
      }

      const momChange = computeMomChange(history);
      const trend = classifyTrend(momChange);
      const alert =
        momChange !== null && Math.abs(momChange) >= alertThresholdPercent;

      return {
        domain: normalizeDomain(domain),
        currentOrganicTraffic: organicTraffic,
        currentOrganicKeywords: organicKeywords,
        momChange,
        trend,
        alert,
        history,
      };
    },
  );

  return {
    competitors,
    source: "dataforseo",
    location,
    alertThresholdPercent,
    dataIssues,
  };
}

// ─── Backlinks ────────────────────────────────────────────────────────────────

const DATAFORSEO_BACKLINKS_SUMMARY_URL =
  "https://api.dataforseo.com/v3/backlinks/summary/live";
const DATAFORSEO_BACKLINKS_NEW_LOST_URL =
  "https://api.dataforseo.com/v3/backlinks/new_lost/live";

export type BacklinkItem = {
  sourceUrl: string;
  sourceDomain: string;
  targetUrl: string;
  domainRank: number | null;
  pageRank: number | null;
  isDoFollow: boolean;
  firstSeen: string | null;
  lastSeen: string | null;
  anchorText: string | null;
  toxic: boolean;
};

export type BacklinksSummary = {
  totalBacklinks: number | null;
  referringDomains: number | null;
  referringIps: number | null;
  brokenBacklinks: number | null;
  domainRank: number | null;
  spamScore: number | null;
  newBacklinks: number | null;
  lostBacklinks: number | null;
};

export type CompetitorBacklinkGain = {
  sourceUrl: string;
  sourceDomain: string;
  targetUrl: string;
  domainRank: number | null;
  isDoFollow: boolean;
  firstSeen: string | null;
  anchorText: string | null;
  isGap: boolean;
};

export type CompetitorBacklinkGains = {
  domain: string;
  newHighDrLinks: CompetitorBacklinkGain[];
  dataIssue?: string;
};

export type BacklinksResponse = {
  domain: string;
  source: "dataforseo";
  dataIssues: string[];
  summary: BacklinksSummary;
  newLinks: BacklinkItem[];
  lostLinks: BacklinkItem[];
  toxicCount: number;
  competitorGains?: CompetitorBacklinkGains[];
};

export async function fetchDataForSeoBacklinksSummary({
  domain,
  login,
  password,
}: {
  domain: string;
  login?: string;
  password?: string;
}): Promise<unknown> {
  return postDataForSeoLive({
    url: DATAFORSEO_BACKLINKS_SUMMARY_URL,
    login,
    password,
    body: [{ target: normalizeDomain(domain), include_subdomains: true }],
  });
}

export async function fetchDataForSeoBacklinksNewLost({
  domain,
  login,
  password,
  limit = 50,
}: {
  domain: string;
  login?: string;
  password?: string;
  limit?: number;
}): Promise<unknown> {
  return postDataForSeoLive({
    url: DATAFORSEO_BACKLINKS_NEW_LOST_URL,
    login,
    password,
    body: [
      {
        target: normalizeDomain(domain),
        include_subdomains: true,
        limit,
        mode: "as_is",
      },
    ],
  });
}

function extractBacklinksSummary(result: unknown): BacklinksSummary {
  const items = extractDataForSeoItems(result);
  const record = recordOrNull(items[0]);
  if (!record) {
    return {
      totalBacklinks: null,
      referringDomains: null,
      referringIps: null,
      brokenBacklinks: null,
      domainRank: null,
      spamScore: null,
      newBacklinks: null,
      lostBacklinks: null,
    };
  }

  return {
    totalBacklinks: numberOrNull(record.total_count),
    referringDomains: numberOrNull(record.referring_domains),
    referringIps: numberOrNull(record.referring_ips),
    brokenBacklinks: numberOrNull(record.broken_backlinks),
    domainRank: numberOrNull(record.rank),
    spamScore: numberOrNull(record.backlinks_spam_score),
    newBacklinks: numberOrNull(record.new_backlinks_count),
    lostBacklinks: numberOrNull(record.lost_backlinks_count),
  };
}

export function extractBacklinkItems(result: unknown): BacklinkItem[] {
  const items = extractDataForSeoItems(result);

  return items
    .map((item) => {
      const record = recordOrNull(item);
      if (!record) return null;

      const sourceUrl =
        stringOrEmpty(record.url_from) || stringOrEmpty(record.source_url);
      if (!sourceUrl) return null;

      const domainRank =
        numberOrNull(record.domain_from_rank) ??
        numberOrNull(record.source_domain_rank);
      const spamScore =
        numberOrNull(record.backlink_spam_score) ??
        numberOrNull(record.spam_score);
      const toxic = (spamScore ?? 0) >= 60;

      return {
        sourceUrl,
        sourceDomain: normalizeDomainValue(sourceUrl),
        targetUrl:
          stringOrEmpty(record.url_to) || stringOrEmpty(record.target_url),
        domainRank,
        pageRank:
          numberOrNull(record.page_from_rank) ??
          numberOrNull(record.source_page_rank),
        isDoFollow: record.dofollow === true,
        firstSeen:
          typeof record.first_seen === "string" ? record.first_seen : null,
        lastSeen:
          typeof record.last_seen === "string" ? record.last_seen : null,
        anchorText: stringOrEmpty(record.anchor) || null,
        toxic,
      } satisfies BacklinkItem;
    })
    .filter((item): item is BacklinkItem => item !== null);
}

function buildCompetitorGains(
  competitorDomains: string[],
  competitorNewLostResults: PromiseSettledResult<unknown>[],
  yourSourceDomains: Set<string>,
  minDR: number,
  dataIssues: string[],
): CompetitorBacklinkGains[] {
  return competitorDomains.map((domain, i) => {
    const result = competitorNewLostResults[i];
    if (result?.status === "rejected") {
      const msg =
        result.reason instanceof Error
          ? result.reason.message
          : "Unknown error";
      dataIssues.push(`${domain} competitor backlinks unavailable: ${msg}`);
      return {
        domain: normalizeDomain(domain),
        newHighDrLinks: [],
        dataIssue: msg,
      };
    }

    const allItems = extractBacklinkItems(result?.value);
    const newHighDrLinks: CompetitorBacklinkGain[] = allItems
      .filter((item) => item.firstSeen && !item.lastSeen)
      .filter((item) => (item.domainRank ?? 0) >= minDR)
      .map((item) => ({
        sourceUrl: item.sourceUrl,
        sourceDomain: item.sourceDomain,
        targetUrl: item.targetUrl,
        domainRank: item.domainRank,
        isDoFollow: item.isDoFollow,
        firstSeen: item.firstSeen,
        anchorText: item.anchorText,
        isGap: !yourSourceDomains.has(item.sourceDomain),
      }));

    return { domain: normalizeDomain(domain), newHighDrLinks };
  });
}

export function buildBacklinksResponse({
  domain,
  summaryResult,
  newLostResult,
  competitorDomains,
  competitorNewLostResults,
  minDR,
  dataIssues,
}: {
  domain: string;
  summaryResult: PromiseSettledResult<unknown>;
  newLostResult: PromiseSettledResult<unknown>;
  competitorDomains?: string[];
  competitorNewLostResults?: PromiseSettledResult<unknown>[];
  minDR?: number;
  dataIssues: string[];
}): BacklinksResponse {
  const summary =
    summaryResult.status === "fulfilled"
      ? extractBacklinksSummary(summaryResult.value)
      : (() => {
          const msg =
            summaryResult.reason instanceof Error
              ? summaryResult.reason.message
              : "Unknown error";
          dataIssues.push(`Backlink summary unavailable: ${msg}`);
          return {
            totalBacklinks: null,
            referringDomains: null,
            referringIps: null,
            brokenBacklinks: null,
            domainRank: null,
            spamScore: null,
            newBacklinks: null,
            lostBacklinks: null,
          };
        })();

  let newLinks: BacklinkItem[] = [];
  let lostLinks: BacklinkItem[] = [];

  if (newLostResult.status === "fulfilled") {
    const allItems = extractBacklinkItems(newLostResult.value);
    newLinks = allItems.filter((item) => item.firstSeen && !item.lastSeen);
    lostLinks = allItems.filter((item) => item.lastSeen);
  } else {
    const msg =
      newLostResult.reason instanceof Error
        ? newLostResult.reason.message
        : "Unknown error";
    dataIssues.push(`New/lost backlinks unavailable: ${msg}`);
  }

  const toxicCount = [...newLinks, ...lostLinks].filter((l) => l.toxic).length;

  const yourSourceDomains = new Set(
    [...newLinks, ...lostLinks].map((l) => l.sourceDomain),
  );

  const competitorGains =
    competitorDomains && competitorNewLostResults
      ? buildCompetitorGains(
          competitorDomains,
          competitorNewLostResults,
          yourSourceDomains,
          minDR ?? 50,
          dataIssues,
        )
      : undefined;

  return {
    domain: normalizeDomain(domain),
    source: "dataforseo",
    dataIssues,
    summary,
    newLinks,
    lostLinks,
    toxicCount,
    ...(competitorGains ? { competitorGains } : {}),
  };
}

// ─── Keyword Changes ──────────────────────────────────────────────────────────

export type KeywordDelta = {
  domain: string;
  currentCount: number | null;
  previousCount: number | null;
  delta: number | null;
  deltaPercent: number | null;
  alert: boolean;
  topKeywords: Array<{
    keyword: string;
    position: number | null;
    searchVolume: number | null;
    url: string | null;
  }>;
  dataIssue?: string;
};

export type KeywordChangesResponse = {
  source: "dataforseo";
  location: string;
  alertThreshold: number;
  dataIssues: string[];
  competitors: KeywordDelta[];
};

function extractKeywordCount(
  historicalResult: PromiseSettledResult<unknown>,
  monthsBack: number,
): number | null {
  if (historicalResult.status === "rejected") return null;

  const now = new Date();
  let targetMonth = now.getMonth() + 1 - monthsBack; // getMonth() is 0-indexed
  let targetYear = now.getFullYear();

  while (targetMonth <= 0) {
    targetMonth += 12;
    targetYear -= 1;
  }

  const items = extractDataForSeoItems(historicalResult.value);
  const match = items.find((item) => {
    const record = recordOrNull(item);
    return (
      record !== null &&
      numberOrNull(record.year) === targetYear &&
      numberOrNull(record.month) === targetMonth
    );
  });

  const record = recordOrNull(match);
  if (!record) return null;

  const metrics = recordOrNull(record.metrics);
  const organic = recordOrNull(metrics?.organic);
  return numberOrNull(organic?.count);
}

function emptyKeywordDelta(domain: string, dataIssue: string): KeywordDelta {
  return {
    domain: normalizeDomain(domain),
    currentCount: null,
    previousCount: null,
    delta: null,
    deltaPercent: null,
    alert: false,
    topKeywords: [],
    dataIssue,
  };
}

function computeKeywordDelta(
  currentCount: number | null,
  previousCount: number | null,
): { delta: number | null; deltaPercent: number | null } {
  if (currentCount === null || previousCount === null) {
    return { delta: null, deltaPercent: null };
  }
  const delta = currentCount - previousCount;
  const deltaPercent =
    previousCount === 0
      ? null
      : Math.round((delta / previousCount) * 10000) / 100;
  return { delta, deltaPercent };
}

function extractTopKeywordsFromRanked(
  rankedResult: PromiseSettledResult<unknown> | undefined,
  domain: string,
  dataIssues: string[],
): KeywordDelta["topKeywords"] {
  if (!rankedResult || rankedResult.status === "rejected") {
    const msg =
      rankedResult?.status === "rejected" &&
      rankedResult.reason instanceof Error
        ? rankedResult.reason.message
        : "ranked keywords unavailable";
    dataIssues.push(`${domain} ranked keywords unavailable: ${msg}`);
    return [];
  }
  return extractRankedKeywords(rankedResult.value)
    .sort((a, b) => a.position - b.position)
    .slice(0, 10)
    .map((kw) => ({
      keyword: kw.keyword,
      position: kw.position,
      searchVolume: kw.searchVolume,
      url: kw.url,
    }));
}

function buildKeywordDeltaEntry(
  domain: string,
  historicalResult: PromiseSettledResult<unknown> | undefined,
  rankedResult: PromiseSettledResult<unknown> | undefined,
  alertThreshold: number,
  dataIssues: string[],
): KeywordDelta {
  if (!historicalResult) {
    dataIssues.push(`${domain}: no historical data result`);
    return emptyKeywordDelta(domain, "no historical data result");
  }

  if (historicalResult.status === "rejected") {
    const msg =
      historicalResult.reason instanceof Error
        ? historicalResult.reason.message
        : "Unknown error";
    dataIssues.push(`${domain} historical data unavailable: ${msg}`);
    return emptyKeywordDelta(domain, msg);
  }

  const currentCount = extractKeywordCount(historicalResult, 0);
  const previousCount = extractKeywordCount(historicalResult, 1);
  const { delta, deltaPercent } = computeKeywordDelta(
    currentCount,
    previousCount,
  );
  const alert = delta !== null && Math.abs(delta) >= alertThreshold;
  const topKeywords = extractTopKeywordsFromRanked(
    rankedResult,
    domain,
    dataIssues,
  );

  return {
    domain: normalizeDomain(domain),
    currentCount,
    previousCount,
    delta,
    deltaPercent,
    alert,
    topKeywords,
  };
}

export function buildKeywordChangesResponse({
  competitorDomains,
  rankedResults,
  historicalResults,
  location,
  alertThreshold,
  dataIssues,
}: {
  competitorDomains: string[];
  rankedResults: PromiseSettledResult<unknown>[];
  historicalResults: PromiseSettledResult<unknown>[];
  location: string;
  alertThreshold: number;
  dataIssues: string[];
}): KeywordChangesResponse {
  const competitors: KeywordDelta[] = competitorDomains.map((domain, i) =>
    buildKeywordDeltaEntry(
      domain,
      historicalResults[i],
      rankedResults[i],
      alertThreshold,
      dataIssues,
    ),
  );

  return {
    source: "dataforseo",
    location,
    alertThreshold,
    dataIssues,
    competitors,
  };
}

// ─── SERP Features ───────────────────────────────────────────────────────────

export type SerpFeatureType =
  | "featured_snippet"
  | "ai_overview"
  | "people_also_ask"
  | "local_pack"
  | "knowledge_panel"
  | "sitelinks"
  | "video_carousel"
  | "image_pack"
  | "shopping"
  | "top_stories";

export type SerpFeatureOwnership = {
  feature: SerpFeatureType;
  ownerDomain: string | null;
  ownerUrl: string | null;
  count?: number;
};

export type KeywordSerpFeatures = {
  keyword: string;
  features: SerpFeatureOwnership[];
  competitorOwnership: Array<{
    domain: string;
    featuresOwned: SerpFeatureType[];
    featureCount: number;
  }>;
  dataIssue?: string;
};

export type SerpFeaturesResponse = {
  source: "dataforseo";
  location: string;
  competitors: string[];
  dataIssues: string[];
  keywords: KeywordSerpFeatures[];
  summary: Array<{
    domain: string;
    totalFeaturesOwned: number;
    featureBreakdown: Partial<Record<SerpFeatureType, number>>;
  }>;
};

const SERP_ITEM_TYPE_MAP: Partial<Record<string, SerpFeatureType>> = {
  featured_snippet: "featured_snippet",
  answer_box: "featured_snippet",
  ai_overview: "ai_overview",
  people_also_ask: "people_also_ask",
  local_pack: "local_pack",
  local_teaser_pack: "local_pack",
  knowledge_graph: "knowledge_panel",
  knowledge_panel: "knowledge_panel",
  sitelinks: "sitelinks",
  video: "video_carousel",
  videos: "video_carousel",
  video_carousel: "video_carousel",
  images: "image_pack",
  image_pack: "image_pack",
  shopping: "shopping",
  shopping_ads: "shopping",
  top_stories: "top_stories",
  news: "top_stories",
};

const DOMAIN_OWNABLE_FEATURES = new Set<SerpFeatureType>([
  "featured_snippet",
  "knowledge_panel",
  "sitelinks",
]);

function extractSerpFeaturesFromItems(
  items: unknown[],
): SerpFeatureOwnership[] {
  const seen = new Map<SerpFeatureType, SerpFeatureOwnership>();

  for (const item of items) {
    const record = recordOrNull(item);
    if (!record) continue;

    const itemType = stringOrEmpty(record.type);

    if (itemType === "organic") {
      if (arrayOrEmpty(record.sitelinks).length > 0 && !seen.has("sitelinks")) {
        const url = stringOrEmpty(record.url) || null;
        seen.set("sitelinks", {
          feature: "sitelinks",
          ownerDomain: normalizeDomainValue(record.url) || null,
          ownerUrl: url,
        });
      }
      continue;
    }

    const feature = SERP_ITEM_TYPE_MAP[itemType];
    if (!feature) continue;

    if (feature === "people_also_ask") {
      const existing = seen.get("people_also_ask");
      if (existing) {
        existing.count = (existing.count ?? 1) + 1;
      } else {
        seen.set("people_also_ask", {
          feature: "people_also_ask",
          ownerDomain: null,
          ownerUrl: null,
          count: 1,
        });
      }
      continue;
    }

    if (seen.has(feature)) continue;

    const ownable = DOMAIN_OWNABLE_FEATURES.has(feature);
    const rawUrl = stringOrEmpty(record.url);
    seen.set(feature, {
      feature,
      ownerDomain: ownable ? normalizeDomainValue(record.url) || null : null,
      ownerUrl: ownable ? rawUrl || null : null,
    });
  }

  return Array.from(seen.values());
}

function buildCompetitorOwnershipForKeyword(
  competitorDomains: string[],
  features: SerpFeatureOwnership[],
): KeywordSerpFeatures["competitorOwnership"] {
  return competitorDomains.map((domain) => {
    const normalized = normalizeDomain(domain);
    const featuresOwned = features
      .filter(
        (f) =>
          f.ownerDomain !== null && domainsMatch(f.ownerDomain, normalized),
      )
      .map((f) => f.feature);
    return {
      domain: normalized,
      featuresOwned,
      featureCount: featuresOwned.length,
    };
  });
}

function buildSerpFeaturesSummary(
  competitorDomains: string[],
  keywordResults: KeywordSerpFeatures[],
): SerpFeaturesResponse["summary"] {
  return competitorDomains.map((domain) => {
    const normalized = normalizeDomain(domain);
    const featureBreakdown: Partial<Record<SerpFeatureType, number>> = {};
    let totalFeaturesOwned = 0;

    for (const kw of keywordResults) {
      const entry = kw.competitorOwnership.find((c) => c.domain === normalized);
      if (!entry) continue;
      for (const feature of entry.featuresOwned) {
        featureBreakdown[feature] = (featureBreakdown[feature] ?? 0) + 1;
        totalFeaturesOwned += 1;
      }
    }

    return { domain: normalized, totalFeaturesOwned, featureBreakdown };
  });
}

export function buildSerpFeaturesResponse({
  keywords,
  competitorDomains,
  serpResults,
  location,
  dataIssues,
}: {
  keywords: string[];
  competitorDomains: string[];
  serpResults: PromiseSettledResult<unknown>[];
  location: string;
  dataIssues: string[];
}): SerpFeaturesResponse {
  const keywordResults: KeywordSerpFeatures[] = keywords.map((keyword, i) => {
    const result = serpResults[i];

    if (!result || result.status === "rejected") {
      const msg =
        result?.status === "rejected" && result.reason instanceof Error
          ? result.reason.message
          : "Unknown error";
      dataIssues.push(`"${keyword}" SERP unavailable: ${msg}`);
      return {
        keyword,
        features: [],
        competitorOwnership: competitorDomains.map((d) => ({
          domain: normalizeDomain(d),
          featuresOwned: [],
          featureCount: 0,
        })),
        dataIssue: msg,
      };
    }

    const items = extractDataForSeoItems(result.value);
    const features = extractSerpFeaturesFromItems(items);
    const competitorOwnership = buildCompetitorOwnershipForKeyword(
      competitorDomains,
      features,
    );

    return { keyword, features, competitorOwnership };
  });

  const summary = buildSerpFeaturesSummary(competitorDomains, keywordResults);

  return {
    source: "dataforseo",
    location,
    competitors: competitorDomains.map(normalizeDomain),
    dataIssues,
    keywords: keywordResults,
    summary,
  };
}

// ─── Top Pages ────────────────────────────────────────────────────────────────

export type TopPage = {
  url: string;
  estimatedTraffic: number | null;
  keywordCount: number | null;
  topKeyword: string | null;
  topKeywordPosition: number | null;
  topKeywordVolume: number | null;
};

export type CompetitorTopPages = {
  domain: string;
  pages: TopPage[];
  dataIssue?: string;
};

export type TopPagesResponse = {
  competitors: CompetitorTopPages[];
  source: "dataforseo";
  location: string;
  dataIssues: string[];
};

const CTR_BY_POSITION: Record<number, number> = {
  1: 0.28,
  2: 0.15,
  3: 0.11,
  4: 0.08,
  5: 0.07,
  6: 0.05,
  7: 0.04,
  8: 0.03,
  9: 0.03,
  10: 0.02,
};

function estimatedClicksByPosition(
  searchVolume: number,
  position: number,
): number {
  const ctr = CTR_BY_POSITION[position] ?? 0.01;
  return Math.round(searchVolume * ctr);
}

function deriveTopPagesFromKeywords(
  keywords: RankedKeyword[],
  limit: number,
): TopPage[] {
  const pageMap = new Map<
    string,
    {
      estimatedTraffic: number;
      keywordCount: number;
      topKeyword: string | null;
      topKeywordPosition: number | null;
      topKeywordVolume: number | null;
      topKeywordClicks: number;
    }
  >();

  for (const kw of keywords) {
    if (!kw.url) continue;
    const clicks = estimatedClicksByPosition(kw.searchVolume ?? 0, kw.position);
    const existing = pageMap.get(kw.url);
    if (existing) {
      existing.estimatedTraffic += clicks;
      existing.keywordCount += 1;
      if (clicks > existing.topKeywordClicks) {
        existing.topKeyword = kw.keyword;
        existing.topKeywordPosition = kw.position;
        existing.topKeywordVolume = kw.searchVolume;
        existing.topKeywordClicks = clicks;
      }
    } else {
      pageMap.set(kw.url, {
        estimatedTraffic: clicks,
        keywordCount: 1,
        topKeyword: kw.keyword,
        topKeywordPosition: kw.position,
        topKeywordVolume: kw.searchVolume,
        topKeywordClicks: clicks,
      });
    }
  }

  return Array.from(pageMap.entries())
    .map(([url, data]) => ({
      url,
      estimatedTraffic: data.estimatedTraffic,
      keywordCount: data.keywordCount,
      topKeyword: data.topKeyword,
      topKeywordPosition: data.topKeywordPosition,
      topKeywordVolume: data.topKeywordVolume,
    }))
    .sort((a, b) => b.estimatedTraffic - a.estimatedTraffic)
    .slice(0, limit);
}

export function buildTopPagesResponse({
  competitorDomains,
  results,
  location,
  limit,
  dataIssues,
}: {
  competitorDomains: string[];
  results: PromiseSettledResult<unknown>[];
  location: string;
  limit: number;
  dataIssues: string[];
}): TopPagesResponse {
  const competitors: CompetitorTopPages[] = competitorDomains.map(
    (domain, i) => {
      const result = results[i];

      if (result?.status === "rejected") {
        const msg =
          result.reason instanceof Error
            ? result.reason.message
            : "Unknown error";
        dataIssues.push(`${domain} top pages unavailable: ${msg}`);
        return { domain: normalizeDomain(domain), pages: [], dataIssue: msg };
      }

      const keywords = extractRankedKeywords(result?.value);
      return {
        domain: normalizeDomain(domain),
        pages: deriveTopPagesFromKeywords(keywords, limit),
      };
    },
  );

  return { competitors, source: "dataforseo", location, dataIssues };
}

// ─── Share of Voice ───────────────────────────────────────────────────────────

// Industry-standard organic CTR curve by position (Sistrix / Advanced Web Ranking)
const CTR_CURVE: Record<number, number> = {
  1: 0.285,
  2: 0.157,
  3: 0.11,
  4: 0.08,
  5: 0.072,
  6: 0.051,
  7: 0.04,
  8: 0.032,
  9: 0.028,
  10: 0.025,
  11: 0.012,
  12: 0.01,
  13: 0.009,
  14: 0.008,
  15: 0.007,
  16: 0.006,
  17: 0.005,
  18: 0.005,
  19: 0.004,
  20: 0.004,
};

function getCtrForPosition(pos: number): number {
  return CTR_CURVE[pos] ?? 0.001;
}

export type SovDomain = {
  domain: string;
  isTracked: boolean;
  absoluteSoV: number;
  relativeSoV: number;
  rankedKeywords: number;
  totalWeightedClicks: number;
  dataIssue?: string;
};

export type SovResponse = {
  source: "dataforseo";
  location: string;
  dataIssues: string[];
  domains: SovDomain[];
  totalMarketSoV: number;
};

export function buildSovResponse({
  trackedDomain,
  competitorDomains,
  results,
  location,
  dataIssues,
}: {
  trackedDomain: string;
  competitorDomains: string[];
  results: PromiseSettledResult<unknown>[];
  location: string;
  dataIssues: string[];
}): SovResponse {
  const allDomains = [trackedDomain, ...competitorDomains];

  const domains: SovDomain[] = allDomains.map((domain, i) => {
    const result = results[i];
    const normalized = normalizeDomain(domain);

    if (result?.status === "rejected") {
      const msg =
        result.reason instanceof Error
          ? result.reason.message
          : "Unknown error";
      dataIssues.push(`${domain} SoV unavailable: ${msg}`);
      return {
        domain: normalized,
        isTracked: i === 0,
        absoluteSoV: 0,
        relativeSoV: 0,
        rankedKeywords: 0,
        totalWeightedClicks: 0,
        dataIssue: msg,
      };
    }

    const keywords = extractRankedKeywords(result?.value);
    let weightedClicks = 0;
    for (const kw of keywords) {
      const vol = kw.searchVolume ?? 0;
      const ctr = getCtrForPosition(kw.position);
      weightedClicks += vol * ctr;
    }

    return {
      domain: normalized,
      isTracked: i === 0,
      absoluteSoV: Math.round(weightedClicks),
      relativeSoV: 0, // filled below
      rankedKeywords: keywords.length,
      totalWeightedClicks: Math.round(weightedClicks),
    };
  });

  const total = domains.reduce((sum, d) => sum + d.absoluteSoV, 0);
  for (const d of domains) {
    d.relativeSoV =
      total > 0 ? Math.round((d.absoluteSoV / total) * 1000) / 10 : 0;
  }

  return {
    source: "dataforseo",
    location,
    dataIssues,
    domains,
    totalMarketSoV: total,
  };
}

// ─── Keyword Intent Classification ───────────────────────────────────────────

export async function fetchDataForSeoKeywordIntentBulk({
  keywords,
  location,
  login,
  password,
}: {
  keywords: string[];
  location?: string;
  login?: string;
  password?: string;
}): Promise<unknown> {
  return postDataForSeoLive({
    url: DATAFORSEO_SEARCH_VOLUME_URL,
    login,
    password,
    body: [
      {
        keywords,
        location_code: getDataForSeoLocationCode(location),
      },
    ],
  });
}

export type KeywordIntentItem = {
  keyword: string;
  searchVolume: number | null;
  mainIntent: string | null;
  foreignIntents: string[];
  intentConfidence: number | null;
  dataIssue?: string;
};

export type KeywordIntentResponse = {
  source: "dataforseo";
  location: string;
  dataIssues: string[];
  keywords: KeywordIntentItem[];
};

export function extractKeywordIntentResults(raw: unknown): KeywordIntentItem[] {
  // postDataForSeoLive returns task.result directly — array from search_volume endpoint
  const items = Array.isArray(raw) ? raw : [];
  const result: KeywordIntentItem[] = [];

  for (const item of items) {
    const r = item as {
      keyword?: string;
      search_volume?: number;
    };

    const kw = r.keyword ?? "";
    if (!kw) continue;

    result.push({
      keyword: kw,
      searchVolume: r.search_volume ?? null,
      // Intent will be populated by LLM in the route layer
      mainIntent: null,
      foreignIntents: [],
      intentConfidence: null,
    });
  }

  return result;
}

export function buildKeywordIntentResponse({
  requestedKeywords,
  result,
  location,
  dataIssues,
}: {
  requestedKeywords: string[];
  result: PromiseSettledResult<unknown>;
  location: string;
  dataIssues: string[];
}): KeywordIntentResponse {
  if (result.status === "rejected") {
    const msg =
      result.reason instanceof Error ? result.reason.message : "Unknown error";
    dataIssues.push(`Keyword intent fetch failed: ${msg}`);
    return {
      source: "dataforseo",
      location,
      dataIssues,
      keywords: requestedKeywords.map((kw) => ({
        keyword: kw,
        searchVolume: null,
        mainIntent: null,
        foreignIntents: [],
        intentConfidence: null,
        dataIssue: msg,
      })),
    };
  }

  const extracted = extractKeywordIntentResults(result.value);

  // Fill any missing keywords not returned by the API
  const returnedSet = new Set(extracted.map((k) => k.keyword.toLowerCase()));
  for (const kw of requestedKeywords) {
    if (!returnedSet.has(kw.toLowerCase())) {
      extracted.push({
        keyword: kw,
        searchVolume: null,
        mainIntent: null,
        foreignIntents: [],
        intentConfidence: null,
        dataIssue: "Not returned by DataForSEO",
      });
    }
  }

  return { source: "dataforseo", location, dataIssues, keywords: extracted };
}
