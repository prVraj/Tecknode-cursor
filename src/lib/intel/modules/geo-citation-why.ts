import { env } from "@/env/server";
import { buildCitationWhyResponse } from "@/lib/intel/citation-why";
import type { ModuleRunner } from "../dispatcher";
import { asOutput, getPrompts, requireEnv } from "./module-helpers";

export const runGeoCitationWhy: ModuleRunner = async ({ entity }) => {
  const apiKey = requireEnv("OPENROUTER_API_KEY", "geo_citation_why");
  // DataForSEO creds are optional — backlinks call degrades gracefully inside buildCitationWhyResponse
  const dataforseoLogin = env.DATAFORSEO_LOGIN?.trim() ?? "";
  const dataforseoPassword = env.DATAFORSEO_PASSWORD?.trim() ?? "";
  const output = await buildCitationWhyResponse({
    domain: entity.domain,
    prompts: getPrompts(entity),
    apiKey,
    dataforseoLogin,
    dataforseoPassword,
  });

  return { output: asOutput(output), signals: [], costUnits: 2 };
};
