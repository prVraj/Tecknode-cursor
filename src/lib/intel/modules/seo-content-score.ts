import {
  extractDataForSeoSerpData,
  fetchDataForSeoSerp,
} from "@/lib/dataforseo";
import { buildContentScoreResponse } from "@/lib/intel/content-score";
import type { ModuleRunner } from "../dispatcher";
import {
  asOutput,
  getDataForSeoCredentials,
  getEntityUrl,
  getLocation,
  getPrompts,
  requireEnv,
} from "./module-helpers";

export const runSeoContentScore: ModuleRunner = async ({ entity }) => {
  // Fail fast (with the capability tag) if Firecrawl isn't configured — the
  // shared cached scrape() reads the key from env itself.
  requireEnv("FIRECRAWL_API_KEY", "seo_content_score");
  const openrouterKey = requireEnv("OPENROUTER_API_KEY", "seo_content_score");
  const { login, password } = getDataForSeoCredentials("seo_content_score");
  const keyword = getPrompts(entity)[0] ?? entity.domain;
  const url = getEntityUrl(entity);
  const dataIssues: string[] = [];
  let competitorUrls: string[] = [];

  try {
    const serpRaw = await fetchDataForSeoSerp({
      keyword,
      location: getLocation(entity),
      login,
      password,
    });
    const targetHost = url.replace(/^https?:\/\//, "").replace(/^www\./, "");
    competitorUrls = extractDataForSeoSerpData(serpRaw)
      .organic.filter((item) => !item.link.includes(targetHost))
      .slice(0, 3)
      .map((item) => item.link);
  } catch (error) {
    dataIssues.push(
      error instanceof Error ? error.message : "SERP competitors unavailable",
    );
  }

  const output = await buildContentScoreResponse({
    url,
    keyword,
    competitorUrls,
    openrouterKey,
    dataIssues,
  });

  return { output: asOutput(output), signals: [], costUnits: 2 };
};
