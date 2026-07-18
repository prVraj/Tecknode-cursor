import { buildCoCitationsResponse } from "@/lib/intel/co-citations";
import { probeCoversWave } from "@/lib/intel/geo/probe-match";
import { loadGeoProbeRaw } from "@/lib/intel/geo/probe-state";
import type { ModuleRunner } from "../dispatcher";
import {
  asOutput,
  getBrand,
  getCompetitorDomains,
  getPrompts,
  requireEnv,
} from "./module-helpers";

export const runGeoCoCitations: ModuleRunner = async ({ userId, entity }) => {
  const apiKey = requireEnv("OPENROUTER_API_KEY", "geo_co_citations");
  const competitors = await getCompetitorDomains({ userId, entity });
  const prompts = getPrompts(entity);
  const today = new Date().toISOString().slice(0, 10);

  const probeRaw = await loadGeoProbeRaw(
    {
      userId,
      entityId: entity.id,
      domain: entity.domain,
    },
    today,
  );

  // Same rule as geo_mentions: a partial probe still costs live calls, so it is
  // neither free nor derived-from.
  const fullyReused = probeCoversWave(probeRaw ?? undefined, "search", prompts);

  const output = await buildCoCitationsResponse({
    brand: getBrand(entity),
    competitors,
    prompts,
    apiKey,
    probeRaw: probeRaw ?? undefined,
  });

  return {
    output: asOutput(output),
    signals: [],
    costUnits: fullyReused ? 1 : 2,
    snapshotProvenance: {
      derivedFrom: fullyReused ? ["geo_citations"] : [],
    },
  };
};
