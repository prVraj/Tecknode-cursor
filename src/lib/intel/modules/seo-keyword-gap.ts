import {
  buildKeywordGapResponse,
  extractRankedKeywords,
  fetchDataForSeoRankedKeywords,
  type RankedKeyword,
} from "@/lib/dataforseo";
import type { ModuleRunner } from "../dispatcher";
import {
  asOutput,
  getCompetitorDomains,
  getDataForSeoCredentials,
  getLocation,
  getLocationLabel,
  getNumberPayload,
} from "./module-helpers";

export const runSeoKeywordGap: ModuleRunner = async ({ userId, entity }) => {
  const { login, password } = getDataForSeoCredentials("seo_keyword_gap");
  const competitorDomains = await getCompetitorDomains({
    userId,
    entity,
  });
  const location = getLocation(entity);
  const dataIssues: string[] = [];

  const results = await Promise.allSettled(
    [entity.domain, ...competitorDomains].map((domain) =>
      fetchDataForSeoRankedKeywords({ domain, location, login, password }),
    ),
  );

  const [yourResult, ...competitorResults] = results;
  const yourKeywords: RankedKeyword[] =
    yourResult?.status === "fulfilled"
      ? extractRankedKeywords(yourResult.value)
      : [];

  if (yourResult?.status === "rejected") {
    dataIssues.push(
      `Your domain ranked keywords unavailable: ${
        yourResult.reason instanceof Error
          ? yourResult.reason.message
          : "Unknown error"
      }`,
    );
  }

  const competitorKeywordMaps = competitorDomains.map((domain, index) => {
    const result = competitorResults[index];
    if (result?.status === "fulfilled") {
      const keywords = extractRankedKeywords(result.value);
      return new Map(
        keywords.map((keyword) => [keyword.keyword.toLowerCase(), keyword]),
      );
    }
    const message =
      result?.reason instanceof Error ? result.reason.message : "Unknown error";
    dataIssues.push(
      `Competitor ${domain} ranked keywords unavailable: ${message}`,
    );
    return new Map<string, RankedKeyword>();
  });

  const output = buildKeywordGapResponse({
    domain: entity.domain,
    competitorDomains,
    yourKeywords,
    competitorKeywordMaps,
    location: getLocationLabel(entity),
    minVolume: getNumberPayload(entity, "minVolume", 0),
    maxKD: getNumberPayload(entity, "maxKD", 100),
    dataIssues,
  });

  return { output: asOutput(output), signals: [], costUnits: 1 };
};
