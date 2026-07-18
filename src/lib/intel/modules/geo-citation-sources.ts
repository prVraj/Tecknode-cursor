import {
  buildCitationSourcesResponse,
  type CitationSourcesResponse,
} from "@/lib/intel/citation-sources";
import type { ModuleRunner } from "../dispatcher";
import {
  asOutput,
  getCompetitorDomains,
  getPrompts,
  readTodaySnapshotPayload,
  requireEnv,
} from "./module-helpers";

export const runGeoCitationSources: ModuleRunner = async ({
  userId,
  entity,
}) => {
  const apiKey = requireEnv("OPENROUTER_API_KEY", "geo_citation_sources");

  // geo_citations runs the identical Sonar probe (same builder + args) earlier
  // in the daily drain. Reuse its same-day snapshot instead of re-probing; only
  // recompute when geo_citations hasn't produced a today snapshot yet.
  const today = new Date().toISOString().slice(0, 10);
  const reused = await readTodaySnapshotPayload<CitationSourcesResponse>(
    entity.id,
    "geo_citations",
    today,
  );
  if (reused) {
    return {
      output: asOutput(reused),
      signals: [],
      costUnits: 0,
      snapshotProvenance: {
        derivedFrom: ["geo_citations"],
        sources: [reused.source],
      },
    };
  }

  const competitors = await getCompetitorDomains({ userId, entity });
  const output = await buildCitationSourcesResponse({
    prompts: getPrompts(entity),
    yourDomain: entity.domain,
    competitors,
    apiKey,
  });

  // Probed live — explicitly not derived from geo_citations, or the catalog
  // default would claim an edge we didn't use.
  return {
    output: asOutput(output),
    signals: [],
    costUnits: 2,
    snapshotProvenance: { derivedFrom: [] },
  };
};
