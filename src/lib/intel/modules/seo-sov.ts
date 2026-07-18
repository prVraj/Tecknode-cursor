import {
  buildSovResponse,
  fetchDataForSeoRankedKeywords,
} from "@/lib/dataforseo";
import type { ModuleRunner } from "../dispatcher";
import {
  asOutput,
  getCompetitorDomains,
  getDataForSeoCredentials,
  getLocation,
  getLocationLabel,
} from "./module-helpers";

export const runSeoSov: ModuleRunner = async ({ userId, entity }) => {
  const { login, password } = getDataForSeoCredentials("seo_sov");
  const competitorDomains = await getCompetitorDomains({
    userId,
    entity,
  });
  const location = getLocation(entity);
  const dataIssues: string[] = [];
  const domains = [entity.domain, ...competitorDomains];

  const results = await Promise.allSettled(
    domains.map((domain) =>
      fetchDataForSeoRankedKeywords({ domain, location, login, password }),
    ),
  );

  const output = buildSovResponse({
    trackedDomain: entity.domain,
    competitorDomains,
    results,
    location: getLocationLabel(entity),
    dataIssues,
  });

  return { output: asOutput(output), signals: [], costUnits: 1 };
};
