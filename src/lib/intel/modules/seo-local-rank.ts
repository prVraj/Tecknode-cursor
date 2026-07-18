import type { ModuleRunner } from "../dispatcher";
import {
  asOutput,
  getDataForSeoCredentials,
  getKeywords,
  getLocationLabel,
} from "./module-helpers";

const LOCAL_PACK_URL =
  "https://api.dataforseo.com/v3/serp/google/local_pack/live/regular";

type LocalPackItem = {
  type?: string;
  rank_group?: number;
  domain?: string;
  title?: string;
  rating?: { value?: number; votes_count?: number };
};

async function fetchLocalPack(
  keyword: string,
  location: string,
  credentials: string,
): Promise<LocalPackItem[]> {
  const response = await fetch(LOCAL_PACK_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([
      { keyword, location_name: location, language_code: "en" },
    ]),
  });
  if (!response.ok) return [];
  const data = (await response.json()) as {
    tasks?: { result?: { items?: LocalPackItem[] }[] }[];
  };
  return data.tasks?.[0]?.result?.[0]?.items ?? [];
}

function extractLocalPosition(
  domain: string,
  items: LocalPackItem[],
): number | null {
  const normalized = domain.replace(/^www\./, "");
  for (const item of items) {
    if (
      item.type === "local_pack" &&
      item.domain &&
      (item.domain.includes(normalized) || normalized.includes(item.domain))
    ) {
      return item.rank_group ?? null;
    }
  }
  return null;
}

export const runSeoLocalRank: ModuleRunner = async ({ entity }) => {
  const { login, password } = getDataForSeoCredentials("seo_local_rank");
  const location = getLocationLabel(entity);
  const keywords = getKeywords(entity).slice(0, 5);
  const domain = entity.domain.replace(/^www\./, "");
  const credentials = Buffer.from(`${login}:${password}`).toString("base64");
  const dataIssues: string[] = [];

  if (keywords.length === 0) {
    dataIssues.push("No keywords configured for entity");
    return {
      output: asOutput({
        source: "dataforseo",
        domain: entity.domain,
        location,
        dataIssues,
        localPackPosition: null,
        keywords: [],
        mapsListing: { found: false, rating: null, reviewCount: null },
      }),
      signals: [],
      costUnits: 0,
    };
  }

  const results = await Promise.allSettled(
    keywords.map((kw) => fetchLocalPack(kw, location, credentials)),
  );

  const keywordResults = keywords.map((kw, i) => {
    const result = results[i];
    const items = result?.status === "fulfilled" ? result.value : [];
    return {
      keyword: kw,
      localPackPosition: extractLocalPosition(domain, items),
      competitorPositions: items
        .filter(
          (item) =>
            item.type === "local_pack" &&
            item.domain &&
            !item.domain.includes(domain),
        )
        .slice(0, 3)
        .map((item) => ({
          domain: item.domain ?? "",
          position: item.rank_group ?? 0,
        })),
    };
  });

  const validPositions = keywordResults
    .map((r) => r.localPackPosition)
    .filter((p): p is number => p !== null);

  const localPackPosition =
    validPositions.length > 0
      ? Math.round(
          validPositions.reduce((a, b) => a + b, 0) / validPositions.length,
        )
      : null;

  return {
    output: asOutput({
      source: "dataforseo",
      domain: entity.domain,
      location,
      dataIssues,
      localPackPosition,
      keywords: keywordResults,
      mapsListing: { found: false, rating: null, reviewCount: null },
    }),
    signals: [],
    costUnits: keywords.length,
  };
};
