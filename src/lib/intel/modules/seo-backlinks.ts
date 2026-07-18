import {
  extractDataForSeoAuthoritySummary,
  fetchDataForSeoDomainOverview,
} from "@/lib/dataforseo";
import type { ModuleRunner } from "../dispatcher";
import {
  getDataForSeoCredentials,
  getLocation,
  getLocationLabel,
} from "./module-helpers";

export const runSeoBacklinks: ModuleRunner = async ({ entity }) => {
  const { login, password } = getDataForSeoCredentials("seo_backlinks");
  const dataIssues: string[] = [];
  let rawResult: unknown = null;

  try {
    rawResult = await fetchDataForSeoDomainOverview({
      domain: entity.domain,
      location: getLocation(entity),
      login,
      password,
    });
  } catch (error) {
    dataIssues.push(
      error instanceof Error ? error.message : "Domain overview unavailable",
    );
  }

  return {
    output: {
      domain: entity.domain,
      source: "dataforseo",
      location: getLocationLabel(entity),
      dataIssues,
      summary: extractDataForSeoAuthoritySummary(rawResult),
    },
    signals: [],
    costUnits: 1,
  };
};
