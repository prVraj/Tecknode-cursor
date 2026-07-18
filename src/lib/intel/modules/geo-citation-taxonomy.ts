import type { CitationSourcesResponse } from "@/lib/intel/citation-sources";
import {
  buildCitationTaxonomy,
  type CitationTaxonomy,
} from "@/lib/intel/citation-taxonomy";
import type { StoredDataIssue } from "../connector-output";
import type { ModuleRunner } from "../dispatcher";
import { asOutput, readDependencySnapshot } from "./module-helpers";

export type GeoCitationTaxonomyOutput = CitationTaxonomy & {
  source: "derived/geo_citations";
  dataIssues: StoredDataIssue[];
};

export const runGeoCitationTaxonomy: ModuleRunner = async ({ entity }) => {
  const today = new Date().toISOString().slice(0, 10);
  const dep = await readDependencySnapshot<CitationSourcesResponse>(
    entity.id,
    "geo_citations",
    today,
  );

  if (!dep.ok) {
    return {
      output: asOutput({
        source: "derived/geo_citations",
        ...buildCitationTaxonomy([]),
        dataIssues: dep.dataIssues,
      } satisfies GeoCitationTaxonomyOutput),
      signals: [],
      costUnits: 0,
    };
  }

  const { payload: citations, producerDataIssues } = dep;

  return {
    output: asOutput({
      source: "derived/geo_citations",
      ...buildCitationTaxonomy(citations.topDomains ?? []),
      // Copy the producer's issues verbatim. See `readDependencySnapshot`.
      dataIssues: producerDataIssues,
    } satisfies GeoCitationTaxonomyOutput),
    signals: [],
    costUnits: 0,
  };
};
