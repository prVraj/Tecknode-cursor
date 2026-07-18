import { buildSocialSignalsResponse } from "@/lib/intel/social-signals";
import type { ModuleRunner } from "../dispatcher";
import {
  asOutput,
  getBrand,
  getDataForSeoCredentials,
  getPrompts,
  requireEnv,
} from "./module-helpers";

export const runGeoSocialSignals: ModuleRunner = async ({ entity }) => {
  const apiKey = requireEnv("OPENROUTER_API_KEY", "geo_social_signals");
  const { login, password } = getDataForSeoCredentials("geo_social_signals");
  const output = await buildSocialSignalsResponse({
    prompts: getPrompts(entity),
    yourBrand: getBrand(entity),
    apiKey,
    login,
    password,
  });

  return { output: asOutput(output), signals: [], costUnits: 2 };
};
