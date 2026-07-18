import { buildEngineCitationsResponse } from "@/lib/intel/engine-citations";
import type { ModuleRunner } from "../dispatcher";
import {
  asOutput,
  getCompetitorDomains,
  getPrompts,
  requireEnv,
} from "./module-helpers";

export const runGeoEngineCitations: ModuleRunner = async ({
  userId,
  entity,
}) => {
  const apiKey = requireEnv("OPENROUTER_API_KEY", "geo_engine_citations");
  const competitors = await getCompetitorDomains({ userId, entity });
  const output = await buildEngineCitationsResponse({
    domain: entity.domain,
    competitors,
    prompts: getPrompts(entity),
    apiKey,
  });

  return { output: asOutput(output), signals: [], costUnits: 2 };
};
