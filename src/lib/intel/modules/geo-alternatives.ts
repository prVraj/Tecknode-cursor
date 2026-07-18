import { buildAlternativesResponse } from "@/lib/intel/alternatives";
import type { ModuleRunner } from "../dispatcher";
import {
  asOutput,
  getBrand,
  getCompetitorDomains,
  requireEnv,
} from "./module-helpers";

export const runGeoAlternatives: ModuleRunner = async ({ userId, entity }) => {
  const apiKey = requireEnv("OPENROUTER_API_KEY", "geo_alternatives");
  const competitors = await getCompetitorDomains({ userId, entity });
  const output = await buildAlternativesResponse({
    brand: getBrand(entity),
    competitors,
    apiKey,
  });

  return { output: asOutput(output), signals: [], costUnits: 2 };
};
