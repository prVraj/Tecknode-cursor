import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.SKIP_ENV_VALIDATION = "true";
});

vi.mock("@/lib/observability/api-usage", () => ({
  recordApiUsage: vi.fn(async () => {}),
  withApiUsageContext: vi.fn((_ctx: unknown, fn: () => unknown) => fn()),
  dollarsToMicroUsd: (dollars: number) =>
    !Number.isFinite(dollars) || dollars <= 0
      ? BigInt(0)
      : BigInt(Math.round(dollars * 1_000_000)),
}));

import {
  buildDataForSeoSeoGeoResponse,
  extractDataForSeoSerpData,
  fetchDataForSeoSerp,
  getDataForSeoLocationCode,
  getDataForSeoMissingEnvKeys,
  mockDataForSeoSerpResult,
} from "./dataforseo";

describe("dataforseo utilities", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status_code: 20000,
          status_message: "Ok.",
          tasks: [
            {
              status_code: 20000,
              status_message: "Ok.",
              result: [{ items: mockDataForSeoSerpResult.items }],
            },
          ],
        }),
        status: 200,
        statusText: "OK",
      } as Response),
    );
  });

  it("fetches Google organic SERP data with DataForSEO auth and payload", async () => {
    const result = await fetchDataForSeoSerp({
      keyword: "ai agent platform",
      location: "in",
      login: "test-login",
      password: "test-password",
    });

    expect(result).toEqual([{ items: mockDataForSeoSerpResult.items }]);
    expect(fetch).toHaveBeenCalledWith(
      "https://api.dataforseo.com/v3/serp/google/organic/live/advanced",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: `Basic ${Buffer.from(
            "test-login:test-password",
          ).toString("base64")}`,
          "Content-Type": "application/json",
        }),
        body: JSON.stringify([
          {
            keyword: "ai agent platform",
            location_code: 2356,
            language_code: "en",
            depth: 10,
          },
        ]),
      }),
    );
  });

  it("extracts SERP fields and builds the direct SEO/GEO response", () => {
    const serp = extractDataForSeoSerpData(mockDataForSeoSerpResult);
    const response = buildDataForSeoSeoGeoResponse({
      keyword: "ai agent platform",
      domain: "runagents.io",
      serp,
    });

    expect(response).toMatchObject({
      keyword: "ai agent platform",
      trackedDomain: "runagents.io",
      source: "dataforseo",
      version: "direct",
      seo: {
        yourRank: 2,
        topCompetitors: [
          {
            domain: "competitorhq.com",
            position: 1,
            title: "Best AI Agent Platforms for SaaS Teams",
          },
        ],
        featuredSnippetOwner: "competitorhq.com",
        youOwnFeaturedSnippet: false,
        contentGaps: [
          "What is an AI agent platform?",
          "Which AI agent platform is best for marketing teams?",
        ],
      },
      geo: {
        aiOverviewPresent: true,
        brandMentionedInAiOverview: true,
        citedSources: ["competitorhq.com", "runagents.io"],
      },
      publicDataCoverage: {
        currentlyReturned: expect.arrayContaining(["Keyword rank position"]),
        availableWithPlatformKeys: {
          dataForSeo: expect.arrayContaining(["LLM/AI citation tracking"]),
          publicCrawlerDns: expect.arrayContaining([
            "llms.txt / llms-full.txt audit",
          ]),
        },
        notReturnedYet: expect.arrayContaining(["Ranked keywords"]),
      },
    });
  });

  it("filters empty PAA rows and deduplicates normalized AI citation domains", () => {
    const serp = extractDataForSeoSerpData({
      items: [
        {
          type: "ai_overview",
          references: [
            {
              domain: "www.reddit.com",
              url: "https://www.reddit.com/r/example",
              title: "Reddit thread",
            },
            {
              domain: "reddit.com",
              url: "https://reddit.com/r/another",
              title: "Another Reddit thread",
            },
            {
              url: "https://www.youtube.com/watch?v=123",
              title: "YouTube video",
            },
          ],
        },
        {
          type: "people_also_ask",
          title: "",
          description: "",
          url: "",
        },
        {
          type: "people_also_ask",
          title: "Which AI video tool is best?",
          description: "A useful answer.",
          url: "https://example.com/paa",
        },
      ],
    });
    const response = buildDataForSeoSeoGeoResponse({
      keyword: "best ai video tools",
      domain: "higgsfield.ai",
      serp,
    });

    expect(serp.peopleAlsoAsk).toEqual([
      {
        question: "Which AI video tool is best?",
        snippet: "A useful answer.",
        link: "https://example.com/paa",
      },
    ]);
    expect(response.geo.citedSources).toEqual(["reddit.com", "youtube.com"]);
    expect(response.seo.contentGaps).toEqual(["Which AI video tool is best?"]);
  });

  it("maps supported location aliases and reports missing env keys", () => {
    expect(getDataForSeoLocationCode("in")).toBe(2356);
    expect(getDataForSeoLocationCode("global")).toBe(2840);
    expect(
      getDataForSeoMissingEnvKeys({
        login: "",
        password: "",
        useMockData: false,
      }),
    ).toEqual(["DATAFORSEO_LOGIN", "DATAFORSEO_PASSWORD"]);
    expect(
      getDataForSeoMissingEnvKeys({
        login: "",
        password: "",
        useMockData: true,
      }),
    ).toEqual([]);
  });
});
