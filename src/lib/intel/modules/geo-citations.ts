import { buildCitationSourcesResponse } from "@/lib/intel/citation-sources";
import type { ModuleRunner } from "../dispatcher";
import {
  asOutput,
  getCompetitorDomains,
  getPrompts,
  requireEnv,
} from "./module-helpers";

export const runGeoCitations: ModuleRunner = async ({
  userId,
  entity,
  run,
}) => {
  const apiKey = requireEnv("OPENROUTER_API_KEY", "geo_citations");
  const competitors = await getCompetitorDomains({ userId, entity });
  const output = await buildCitationSourcesResponse({
    prompts: getPrompts(entity),
    yourDomain: entity.domain,
    competitors,
    apiKey,
    probeContext: {
      userId,
      entityId: entity.id,
      domain: entity.domain,
      runId: run.id,
    },
  });

  // As the cluster's probe producer this fetches both waves — citation (1
  // platform) and search (2 platforms) — so ~3x the calls of the citation wave
  // alone. That buys the 7 derived geo_* capabilities a $0 parse instead of
  // each re-probing, which is a net win cluster-wide.
  return {
    output: asOutput(output),
    signals: [],
    costUnits: 6,
    snapshotProvenance: { derivedFrom: [] },
  };
};
