import { describe, expect, it, vi } from "vitest";

// `dataforseo.ts` reaches Redis and the usage repo through `fetch-cache` and
// `api-usage`. Stub the leaves so the pure extractor can be exercised directly.
vi.mock("@/env/server", () => ({
  env: {
    DATABASE_URL: "postgres://test",
    DATAFORSEO_LOGIN: "login",
    DATAFORSEO_PASSWORD: "password",
  },
}));
vi.mock("@/lib/redis", () => ({ redis: null }));
vi.mock("@/lib/observability/api-usage", () => ({
  recordApiUsage: vi.fn(),
  dollarsToMicroUsd: () => 0,
}));

import { extractAiSearchVolumeItems } from "@/lib/dataforseo";

/**
 * The envelope below is copied from a live call to
 * `ai_optimization/ai_keyword_data/keywords_search_volume/live`:
 * `task.result` is `[{ location_code, language_code, items_count, items }]`.
 */
const LIVE_ENVELOPE = [
  {
    location_code: 2840,
    language_code: "en",
    items_count: 1,
    items: [
      {
        keyword: "project management software",
        ai_search_volume: 1263,
        ai_monthly_searches: [
          { year: 2026, month: 6, ai_search_volume: 1263 },
          { year: 2026, month: 5, ai_search_volume: 1674 },
        ],
      },
    ],
  },
];

describe("extractAiSearchVolumeItems", () => {
  it("parses the live response envelope", () => {
    expect(extractAiSearchVolumeItems(LIVE_ENVELOPE)).toEqual([
      {
        keyword: "project management software",
        aiSearchVolume: 1263,
        monthlySearches: [
          { year: 2026, month: 6, aiSearchVolume: 1263 },
          { year: 2026, month: 5, aiSearchVolume: 1674 },
        ],
      },
    ]);
  });

  it("returns an empty list for a null or malformed result", () => {
    expect(extractAiSearchVolumeItems(null)).toEqual([]);
    expect(extractAiSearchVolumeItems({})).toEqual([]);
    expect(extractAiSearchVolumeItems([{ items: "nope" }])).toEqual([]);
  });

  it("drops items with no keyword", () => {
    expect(
      extractAiSearchVolumeItems([
        {
          items: [
            { ai_search_volume: 10 },
            { keyword: "", ai_search_volume: 5 },
          ],
        },
      ]),
    ).toEqual([]);
  });

  it("preserves a null volume rather than coercing it to 0", () => {
    // A missing measurement must stay distinguishable from measured-zero demand.
    expect(
      extractAiSearchVolumeItems([
        { items: [{ keyword: "obscure term", ai_search_volume: null }] },
      ]),
    ).toEqual([
      { keyword: "obscure term", aiSearchVolume: null, monthlySearches: [] },
    ]);
  });

  it("skips malformed month entries without dropping the keyword", () => {
    expect(
      extractAiSearchVolumeItems([
        {
          items: [
            {
              keyword: "crm",
              ai_search_volume: 7,
              ai_monthly_searches: [
                { year: 2026, month: 6, ai_search_volume: 7 },
                { year: null, month: 5, ai_search_volume: 3 },
                "garbage",
              ],
            },
          ],
        },
      ]),
    ).toEqual([
      {
        keyword: "crm",
        aiSearchVolume: 7,
        monthlySearches: [{ year: 2026, month: 6, aiSearchVolume: 7 }],
      },
    ]);
  });
});
