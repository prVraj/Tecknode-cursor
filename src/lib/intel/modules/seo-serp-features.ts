import {
  buildSerpFeaturesResponse,
  fetchDataForSeoSerp,
} from "@/lib/dataforseo";
import type { ModuleRunner } from "../dispatcher";
import {
  asOutput,
  getCompetitorDomains,
  getDataForSeoCredentials,
  getLocation,
  getLocationLabel,
  getPrompts,
} from "./module-helpers";

export const runSeoSerpFeatures: ModuleRunner = async ({ userId, entity }) => {
  const { login, password } = getDataForSeoCredentials("seo_serp_features");
  const competitorDomains = await getCompetitorDomains({
    userId,
    entity,
  });
  const keywords = getPrompts(entity);
  const location = getLocation(entity);
  const dataIssues: string[] = [];

  const serpResults = await Promise.allSettled(
    keywords.map((keyword) =>
      fetchDataForSeoSerp({ keyword, location, login, password }),
    ),
  );

  const output = buildSerpFeaturesResponse({
    keywords,
    competitorDomains,
    serpResults,
    location: getLocationLabel(entity),
    dataIssues,
  });

  return { output: asOutput(output), signals: [], costUnits: 1 };
};
