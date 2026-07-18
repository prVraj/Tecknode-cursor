import type { GeoProbeWave } from "@/lib/intel/geo/probe-config";

/**
 * Canonical raw artifact from the daily GEO probe (L2-1).
 *
 * v2 tags every row with the `wave` (and its `temperature`) that produced it,
 * so a consumer can prove a stored response matches the config it would have
 * fetched itself before reusing it. v1 blobs predate the search wave and were
 * citation-only; `normalizeGeoProbeRaw` upgrades them on read.
 */
export interface GeoProbeRaw {
  schemaVersion: 1 | 2;
  probedAt: string;
  entityId: string;
  domain: string;
  prompts: string[];
  results: GeoProbeResult[];
  provenance: {
    producer: "geo_probe";
    runId: string;
    sources: string[];
  };
}

export interface GeoProbeResult {
  /** Config tuple this row was fetched under. Absent on v1 blobs. */
  wave?: GeoProbeWave;
  temperature?: number;
  platformId: string;
  model: string;
  prompt: string;
  responseText: string;
  citations: string[];
  usage?: { promptTokens: number; completionTokens: number };
  dataIssue?: string;
}

/**
 * Upgrade a stored blob to v2 semantics. v1 rows were all citation-wave, so
 * tagging them as such keeps citation consumers working across the deploy
 * while correctly denying them to search-wave consumers — whose config never
 * matched those rows in the first place.
 */
export function normalizeGeoProbeRaw(raw: GeoProbeRaw): GeoProbeRaw {
  if (raw.schemaVersion === 2) return raw;
  return {
    ...raw,
    schemaVersion: 2,
    results: raw.results.map((r) => ({
      ...r,
      wave: r.wave ?? "citation",
      temperature: r.temperature ?? 0.1,
    })),
  };
}
