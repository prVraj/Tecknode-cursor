import {
  buildCitationSourcesResponse,
  type CitationSourcesResponse,
} from "@/lib/intel/citation-sources";
import { parseCitationSourcesFromProbe } from "@/lib/intel/geo/parsers/citation-sources";
import { isProbeResultUsable, waveResults } from "@/lib/intel/geo/probe-match";
import { loadGeoProbeRaw } from "@/lib/intel/geo/probe-state";
import type { CapabilityKey, TrackedEntity } from "@/server/db/schema";
import {
  getCompetitorDomains,
  getPrompts,
  readTodaySnapshotPayload,
} from "../modules/module-helpers";

export type CitationSourcesResolution = {
  sources: CitationSourcesResponse;
  costUnits: number;
  /**
   * What this resolution actually derived from — `["geo_citations"]` on reuse,
   * `[]` when it fell back to a live probe. Always populated: an omitted value
   * lets `buildSnapshotProvenance` fall back to the catalog's *asserted* edges,
   * which would claim derivation from a producer we never read.
   */
  derivedFrom: CapabilityKey[];
};

/**
 * Three-tier citation ingest for derived GEO capabilities:
 * 1. Today's GeoProbeRaw in entity_state → parser (cost 0)
 * 2. Today's geo_citations snapshot (cost 0)
 * 3. Fallback live probe (cost 2)
 */
export async function resolveCitationSources({
  userId,
  entity,
  today,
  apiKey,
}: {
  userId: string;
  entity: TrackedEntity;
  today: string;
  apiKey: string;
}): Promise<CitationSourcesResolution> {
  const probeRaw = await loadGeoProbeRaw(
    {
      userId,
      entityId: entity.id,
      domain: entity.domain,
    },
    today,
  );

  // Presence is not enough: a probe whose citation calls all failed is
  // persisted with empty text + dataIssue, and treating that as a hit would
  // pin every derived capability to a zeroed payload for the rest of the day.
  const usableCitationRows = probeRaw
    ? waveResults(probeRaw.results, "citation").filter(isProbeResultUsable)
    : [];

  if (probeRaw && usableCitationRows.length > 0) {
    const competitors = await getCompetitorDomains({ userId, entity });
    return {
      sources: parseCitationSourcesFromProbe(probeRaw, {
        yourDomain: entity.domain,
        competitors,
      }),
      costUnits: 0,
      derivedFrom: ["geo_citations"],
    };
  }

  const reused = await readTodaySnapshotPayload<CitationSourcesResponse>(
    entity.id,
    "geo_citations",
    today,
  );
  if (reused) {
    return { sources: reused, costUnits: 0, derivedFrom: ["geo_citations"] };
  }

  const competitors = await getCompetitorDomains({ userId, entity });
  const sources = await buildCitationSourcesResponse({
    prompts: getPrompts(entity),
    yourDomain: entity.domain,
    competitors,
    apiKey,
  });

  return { sources, costUnits: 2, derivedFrom: [] };
}
