import {
  type GeoProbeRaw,
  normalizeGeoProbeRaw,
} from "@/lib/intel/geo/probe-types";
import { entityStateRepo } from "@/server/db/repos/entity-state.repo";
import { logExternalFailure } from "@/utils/log-external";

const GEO_PROBE_KEY_PREFIX = "geo:probe:";

/**
 * Identity for a persisted GEO probe blob. The DB row is keyed by `entityId`;
 * `domain` is retained inside the payload for readability.
 */
export interface EntityStateRef {
  userId: string;
  entityId: string;
  domain: string;
}

export function geoProbeStateKey(date: string): string {
  return `${GEO_PROBE_KEY_PREFIX}${date}`;
}

export async function loadGeoProbeRaw(
  ref: EntityStateRef,
  date: string,
): Promise<GeoProbeRaw | null> {
  try {
    const row = await entityStateRepo.find(
      ref.entityId,
      geoProbeStateKey(date),
    );
    if (!row) return null;
    return normalizeGeoProbeRaw(row.payload as unknown as GeoProbeRaw);
  } catch (err) {
    // Non-fatal on read: the probe is an optimisation, not a data source. A
    // transient entity_state blip must not fail the consumer's run — it just
    // means no cache hit, so the caller falls back to fetching live.
    logExternalFailure("fetch", "geo.loadGeoProbeRaw", err, {
      domain: ref.domain,
      entityId: ref.entityId,
      date,
    });
    return null;
  }
}

export async function saveGeoProbeRaw(
  ref: EntityStateRef,
  date: string,
  raw: GeoProbeRaw,
): Promise<void> {
  try {
    await entityStateRepo.upsert({
      userId: ref.userId,
      entityId: ref.entityId,
      stateKey: geoProbeStateKey(date),
      payload: raw as unknown as Record<string, unknown>,
    });
  } catch (err) {
    // Non-fatal on save: probe data was already fetched (paid). Log and
    // continue so this run's intel is not discarded — downstream reuse may
    // miss until persistence succeeds.
    logExternalFailure("fetch", "geo.saveGeoProbeRaw", err, {
      domain: ref.domain,
      entityId: ref.entityId,
      date,
    });
  }
}
