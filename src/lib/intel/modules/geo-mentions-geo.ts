import { buildAiMentionsGeoResponse } from "@/lib/intel/ai-mentions-geo";
import type { ModuleRunner } from "../dispatcher";
import {
  asOutput,
  getBrand,
  getCompetitorDomains,
  getCountries,
  getPrompts,
  requireEnv,
} from "./module-helpers";

export const runGeoMentionsGeo: ModuleRunner = async ({ userId, entity }) => {
  const apiKey = requireEnv("OPENROUTER_API_KEY", "geo_mentions_geo");
  const competitors = await getCompetitorDomains({ userId, entity });
  const output = await buildAiMentionsGeoResponse({
    brand: getBrand(entity),
    competitors,
    basePrompts: getPrompts(entity),
    countries: getCountries(entity),
    apiKey,
  });

  return { output: asOutput(output), signals: [], costUnits: 2 };
};
