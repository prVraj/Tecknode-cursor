import { buildCompetitorVisibilityResponse } from "@/lib/intel/competitor-visibility";
import type { ModuleRunner } from "../dispatcher";
import {
  asOutput,
  getCompetitorDomains,
  getPrompts,
  requireEnv,
} from "./module-helpers";

export const runGeoCompetitorVisibility: ModuleRunner = async ({
  userId,
  entity,
}) => {
  const apiKey = requireEnv("OPENROUTER_API_KEY", "geo_competitor_visibility");
  const competitors = await getCompetitorDomains({ userId, entity });
  const output = await buildCompetitorVisibilityResponse({
    domain: entity.domain,
    competitors,
    prompts: getPrompts(entity),
    apiKey,
  });

  return { output: asOutput(output), signals: [], costUnits: 2 };
};
