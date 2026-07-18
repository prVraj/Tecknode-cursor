import {
  buildAiTrafficEstimateFromCitationSources,
  buildAiTrafficEstimateResponse,
} from "@/lib/intel/ai-traffic-estimate";
import { resolveCitationSources } from "@/lib/intel/geo/resolve-citation-sources";
import type { ModuleRunner } from "../dispatcher";
import { asOutput, getPrompts, requireEnv } from "./module-helpers";

export const runGeoTrafficEstimate: ModuleRunner = async ({
  userId,
  entity,
}) => {
  const today = new Date().toISOString().slice(0, 10);
  const apiKey = requireEnv("OPENROUTER_API_KEY", "geo_traffic_estimate");

  const { sources, costUnits, derivedFrom } = await resolveCitationSources({
    userId,
    entity,
    today,
    apiKey,
  });

  if (sources.rawResults?.length) {
    const output = buildAiTrafficEstimateFromCitationSources(sources);
    return {
      output: asOutput(output),
      signals: [],
      costUnits,
      snapshotProvenance: { derivedFrom },
    };
  }

  const output = await buildAiTrafficEstimateResponse({
    domain: entity.domain,
    prompts: getPrompts(entity),
    apiKey,
  });

  // Own live estimate — derived from nothing upstream.
  return {
    output: asOutput(output),
    signals: [],
    costUnits: costUnits + 2,
    snapshotProvenance: { derivedFrom: [] },
  };
};
