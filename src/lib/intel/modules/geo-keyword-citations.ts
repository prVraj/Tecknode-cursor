import { parseKeywordMatrixFromProbe } from "@/lib/intel/geo/parsers/keyword-citations";
import { isProbeResultUsable, waveResults } from "@/lib/intel/geo/probe-match";
import { loadGeoProbeRaw } from "@/lib/intel/geo/probe-state";
import { buildKeywordCitationMatrix } from "@/lib/intel/keyword-citations";
import type { ModuleRunner } from "../dispatcher";
import {
  asOutput,
  getCompetitorDomains,
  getPrompts,
  requireEnv,
} from "./module-helpers";

export const runGeoKeywordCitations: ModuleRunner = async ({
  userId,
  entity,
}) => {
  const apiKey = requireEnv("OPENROUTER_API_KEY", "geo_keyword_citations");
  const competitors = await getCompetitorDomains({ userId, entity });
  const keywords = getPrompts(entity);
  const today = new Date().toISOString().slice(0, 10);

  const probeRaw = await loadGeoProbeRaw(
    { userId, entityId: entity.id, domain: entity.domain },
    today,
  );

  // The keyword matrix is a pivot of the same citation-wave rows geo_citations
  // already fetched — parse them instead of re-probing. Health-gated: a probe
  // whose citation calls all failed is not a cache hit.
  const usableCitations = probeRaw
    ? waveResults(probeRaw.results, "citation").filter(isProbeResultUsable)
    : [];

  if (probeRaw && usableCitations.length > 0) {
    return {
      output: asOutput(
        parseKeywordMatrixFromProbe(probeRaw, {
          domain: entity.domain,
          competitors,
          keywords,
        }),
      ),
      signals: [],
      costUnits: 0,
      snapshotProvenance: { derivedFrom: ["geo_citations"] },
    };
  }

  const output = await buildKeywordCitationMatrix({
    domain: entity.domain,
    competitors,
    keywords,
    apiKey,
  });

  return {
    output: asOutput(output),
    signals: [],
    costUnits: 2,
    snapshotProvenance: { derivedFrom: [] },
  };
};
