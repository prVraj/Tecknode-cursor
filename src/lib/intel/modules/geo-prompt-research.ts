import { buildPromptResearchResponse } from "@/lib/intel/prompt-research";
import type { ModuleRunner } from "../dispatcher";
import {
  asOutput,
  getDataForSeoCredentials,
  getLocation,
  getNumberPayload,
  getPrompts,
  requireEnv,
} from "./module-helpers";

export const runGeoPromptResearch: ModuleRunner = async ({ entity }) => {
  const { login, password } = getDataForSeoCredentials("geo_prompt_research");
  const apiKey = requireEnv("OPENROUTER_API_KEY", "geo_prompt_research");
  const output = await buildPromptResearchResponse({
    keyword: getPrompts(entity)[0] ?? entity.domain,
    location: getLocation(entity),
    limit: getNumberPayload(entity, "limit", 20),
    login,
    password,
    apiKey,
  });

  return { output: asOutput(output), signals: [], costUnits: 2 };
};
