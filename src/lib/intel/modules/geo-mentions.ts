import { buildAiMentionsResponse } from "@/lib/intel/ai-mentions";
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

export const runGeoMentions: ModuleRunner = async ({ userId, entity }) => {
  const apiKey = requireEnv("OPENROUTER_API_KEY", "geo_mentions");
  const competitors = await getCompetitorDomains({ userId, entity });
  const prompts = getPrompts(entity);
  const today = new Date().toISOString().slice(0, 10);

  const probeRaw = await loadGeoProbeRaw(
    { userId, entityId: entity.id, domain: entity.domain },
    today,
  );

  // Only claim the probe when it covers every search-wave task. A partial probe
  // means we still paid for live calls, so neither the cost nor the provenance
  // may say otherwise.
  const fullyReused = probeCoversWave(probeRaw ?? undefined, "search", prompts);

  const output = await buildAiMentionsResponse({
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
    // Always explicit: omitting it would let the catalog assert a geo_citations
    // edge even on the live-fetch path.
    snapshotProvenance: {
      derivedFrom: fullyReused ? ["geo_citations"] : [],
    },
  };
};
