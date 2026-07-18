import {
  extractDataForSeoSerpData,
  fetchDataForSeoSerp,
} from "@/lib/dataforseo";
import type { ModuleRunner } from "../dispatcher";
import {
  asOutput,
  getCountries,
  getDataForSeoCredentials,
  getKeywords,
} from "./module-helpers";

function findDomainPosition(
  domain: string,
  organic: { domain: string; position: number }[],
): number | null {
  const match = organic.find(
    (r) =>
      r.domain.replace(/^www\./, "") === domain.replace(/^www\./, "") ||
      domain.replace(/^www\./, "").includes(r.domain.replace(/^www\./, "")),
  );
  return match?.position ?? null;
}

export const runSeoInternationalRank: ModuleRunner = async ({ entity }) => {
  const { login, password } = getDataForSeoCredentials(
    "seo_international_rank",
  );
  const countries = getCountries(entity);
  const keywords = getKeywords(entity).slice(0, 3);
  const domain = entity.domain.replace(/^www\./, "");
  const dataIssues: string[] = [];

  if (keywords.length === 0) {
    dataIssues.push("No keywords configured for entity");
    return {
      output: asOutput({
        source: "dataforseo",
        domain: entity.domain,
        countries,
        keywords,
        dataIssues,
        avgInternationalRank: 999,
        countryBreakdown: [],
      }),
      signals: [],
      costUnits: 0,
    };
  }

  const combos = countries.flatMap((country) =>
    keywords.map((kw) => ({ country, keyword: kw })),
  );

  const results = await Promise.allSettled(
    combos.map(({ country, keyword }) =>
      fetchDataForSeoSerp({ keyword, location: country, login, password }),
    ),
  );

  const countryMap = new Map<
    string,
    { keyword: string; position: number | null }[]
  >();

  for (let i = 0; i < combos.length; i++) {
    const combo = combos[i];
    if (!combo) continue;
    const { country, keyword } = combo;
    const result = results[i];
    let position: number | null = null;

    if (result?.status === "fulfilled") {
      const serp = extractDataForSeoSerpData(result.value);
      position = findDomainPosition(domain, serp.organic);
    }

    const existing = countryMap.get(country) ?? [];
    existing.push({ keyword, position });
    countryMap.set(country, existing);
  }

  const countryBreakdown = Array.from(countryMap.entries()).map(
    ([country, kwResults]) => {
      const validPositions = kwResults
        .map((r) => r.position ?? 999)
        .filter(Boolean);
      const avgRank =
        validPositions.length > 0
          ? Math.round(
              validPositions.reduce((a, b) => a + b, 0) / validPositions.length,
            )
          : 999;
      return { country, avgRank, keywords: kwResults };
    },
  );

  const allRanks = countryBreakdown.map((c) => c.avgRank);
  const avgInternationalRank =
    allRanks.length > 0
      ? Math.round(allRanks.reduce((a, b) => a + b, 0) / allRanks.length)
      : 999;

  return {
    output: asOutput({
      source: "dataforseo",
      domain: entity.domain,
      countries,
      keywords,
      dataIssues,
      avgInternationalRank,
      countryBreakdown,
    }),
    signals: [],
    costUnits: combos.length,
  };
};
