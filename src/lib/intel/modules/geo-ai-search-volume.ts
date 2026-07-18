import {
  type AiSearchVolumeItem,
  extractAiSearchVolumeItems,
  fetchDataForSeoAiSearchVolume,
} from "@/lib/dataforseo";
import type { StoredDataIssue } from "../connector-output";
import type { ModuleRunner } from "../dispatcher";
import {
  asOutput,
  getDataForSeoCredentials,
  getKeywords,
  getLocation,
  getLocationLabel,
} from "./module-helpers";

export type GeoAiSearchVolumeOutput = {
  source: "dataforseo";
  location: string;
  keywords: AiSearchVolumeItem[];
  /** Summed AI-search volume across tracked keywords; the primaryScoreField. */
  totalAiSearchVolume: number | null;
  dataIssues: StoredDataIssue[];
};

/**
 * Billing is a flat ~$0.01 per request plus ~$0.0001 per keyword, so the whole
 * set goes in one call and the cap exists to bound payload size, not spend.
 */
const MAX_KEYWORDS = 200;

export const runGeoAiSearchVolume: ModuleRunner = async ({ entity }) => {
  const { login, password } = getDataForSeoCredentials("geo_ai_search_volume");
  const keywords = getKeywords(entity).slice(0, MAX_KEYWORDS);

  if (keywords.length === 0) {
    // Deliberately not `getPrompts`, which falls back to the brand name — that
    // would bill a request to measure demand for a keyword nobody tracks.
    return {
      output: asOutput({
        source: "dataforseo",
        location: getLocationLabel(entity),
        keywords: [],
        totalAiSearchVolume: null,
        dataIssues: [
          {
            code: "ENTITY_CONFIG",
            detail: "No tracked keywords configured for this entity",
          },
        ],
      } satisfies GeoAiSearchVolumeOutput),
      signals: [],
      costUnits: 0,
    };
  }

  // A DataForSeoApiError propagates: `executeConnectorRun` marks the run failed
  // rather than persisting a snapshot whose null score would look like "no AI
  // search demand" instead of "we never measured".
  const raw = await fetchDataForSeoAiSearchVolume({
    keywords,
    location: getLocation(entity),
    login,
    password,
  });

  const items = extractAiSearchVolumeItems(raw);
  const measured = items.filter((item) => item.aiSearchVolume !== null);

  return {
    output: asOutput({
      source: "dataforseo",
      location: getLocationLabel(entity),
      keywords: items,
      totalAiSearchVolume:
        measured.length > 0
          ? measured.reduce((sum, item) => sum + (item.aiSearchVolume ?? 0), 0)
          : null,
      dataIssues: [],
    } satisfies GeoAiSearchVolumeOutput),
    signals: [],
    costUnits: 1,
  };
};
