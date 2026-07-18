import {
  extractRankedKeywords,
  fetchDataForSeoRankedKeywords,
  type RankedKeyword,
} from "@/lib/dataforseo";
import type { ModuleRunner } from "../dispatcher";
import {
  getDataForSeoCredentials,
  getLocation,
  getLocationLabel,
} from "./module-helpers";

function inferIntent(keyword: string): string {
  const lower = keyword.toLowerCase();
  if (/^(what|how|why|when|where|who|guide|tutorial)\b/.test(lower)) {
    return "informational";
  }
  if (/\b(best|top|review|compare|vs|alternative|alternatives)\b/.test(lower)) {
    return "commercial";
  }
  if (
    /\b(buy|price|pricing|coupon|demo|trial|download|subscribe)\b/.test(lower)
  ) {
    return "transactional";
  }
  if (/\b(login|website|homepage|app|support)\b/.test(lower)) {
    return "navigational";
  }
  return "informational";
}

function groupByIntent(keywords: RankedKeyword[]) {
  const groups: Record<string, RankedKeyword[]> = {};
  for (const keyword of keywords) {
    const intent = keyword.intent ?? inferIntent(keyword.keyword);
    groups[intent] = [...(groups[intent] ?? []), keyword];
  }
  return groups;
}

export const runSeoKeywordIntent: ModuleRunner = async ({ entity }) => {
  const { login, password } = getDataForSeoCredentials("seo_keyword_intent");
  const location = getLocation(entity);
  const dataIssues: string[] = [];
  let keywords: RankedKeyword[] = [];

  try {
    const raw = await fetchDataForSeoRankedKeywords({
      domain: entity.domain,
      location,
      login,
      password,
    });
    keywords = extractRankedKeywords(raw);
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
      totalKeywords: keywords.length,
      intents: groupByIntent(keywords),
    },
    signals: [],
    costUnits: 1,
  };
};
