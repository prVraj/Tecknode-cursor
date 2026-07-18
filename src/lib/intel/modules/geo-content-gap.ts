import { buildContentGapResponse } from "@/lib/intel/content-gap";
import type { ModuleRunner } from "../dispatcher";
import {
  asOutput,
  getCompetitorDomains,
  getDataForSeoCredentials,
  getPrompts,
  requireEnv,
} from "./module-helpers";

export const runGeoContentGap: ModuleRunner = async ({ userId, entity }) => {
  const apiKey = requireEnv("OPENROUTER_API_KEY", "geo_content_gap");
  const { login, password } = getDataForSeoCredentials("geo_content_gap");
  const competitors = await getCompetitorDomains({ userId, entity });
  const output = await buildContentGapResponse({
    domain: entity.domain,
    competitors,
    prompts: getPrompts(entity),
    apiKey,
    dataForSeoLogin: login,
    dataForSeoPassword: password,
  });

  return { output: asOutput(output), signals: [], costUnits: 2 };
};
