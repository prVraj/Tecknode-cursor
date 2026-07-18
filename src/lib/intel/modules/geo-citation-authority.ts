import { buildCitationAuthorityResponse } from "@/lib/intel/citation-authority";
import { resolveCitationSources } from "@/lib/intel/geo/resolve-citation-sources";
import type { ModuleRunner } from "../dispatcher";
import {
  asOutput,
  getDataForSeoCredentials,
  getNumberPayload,
  getPrompts,
  requireEnv,
} from "./module-helpers";

export const runGeoCitationAuthority: ModuleRunner = async ({
  userId,
  entity,
}) => {
  const today = new Date().toISOString().slice(0, 10);
  const apiKey = requireEnv("OPENROUTER_API_KEY", "geo_citation_authority");
  const { login, password } = getDataForSeoCredentials(
    "geo_citation_authority",
  );

  const {
    sources: citationSources,
    costUnits,
    derivedFrom,
  } = await resolveCitationSources({
    userId,
    entity,
    today,
    apiKey,
  });

  const output = await buildCitationAuthorityResponse({
    prompts: getPrompts(entity),
    yourDomain: entity.domain,
    limit: getNumberPayload(entity, "limit", 20),
    apiKey,
    dataForSeoLogin: login,
    dataForSeoPassword: password,
    citationSources,
  });

  return {
    output: asOutput(output),
    signals: [],
    costUnits,
    snapshotProvenance: { derivedFrom },
  };
};
