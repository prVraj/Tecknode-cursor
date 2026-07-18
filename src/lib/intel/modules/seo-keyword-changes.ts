import {
  extractRankedKeywords,
  fetchDataForSeoRankedKeywords,
} from "@/lib/dataforseo";
import type { ModuleRunner } from "../dispatcher";
import {
  getDataForSeoCredentials,
  getLocation,
  getLocationLabel,
} from "./module-helpers";

export const runSeoKeywordChanges: ModuleRunner = async ({ entity }) => {
  const { login, password } = getDataForSeoCredentials("seo_keyword_changes");
  const location = getLocation(entity);
  const dataIssues: string[] = [];
  let rawResult: unknown = null;

  try {
    rawResult = await fetchDataForSeoRankedKeywords({
      domain: entity.domain,
      location,
      login,
      password,
    });
  } catch (error) {
    dataIssues.push(
      error instanceof Error ? error.message : "Ranked keywords unavailable",
    );
  }

  return {
    output: {
      source: "dataforseo",
      domain: entity.domain,
      location: getLocationLabel(entity),
      dataIssues,
      rankedKeywords: rawResult ? extractRankedKeywords(rawResult) : [],
      rawResult,
    },
    signals: [],
    costUnits: 1,
  };
};
