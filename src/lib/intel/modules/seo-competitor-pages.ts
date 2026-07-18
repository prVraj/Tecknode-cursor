import { buildCompetitorPagesResponse } from "@/lib/intel/competitor-pages";
import type { ModuleRunner } from "../dispatcher";
import {
  getCompetitorDomains,
  getDataForSeoCredentials,
  getLocation,
  getNumberPayload,
  getStringArrayPayload,
} from "./module-helpers";

export const runSeoCompetitorPages: ModuleRunner = async ({
  userId,
  entity,
}) => {
  const { login, password } = getDataForSeoCredentials("seo_competitor_pages");
  const competitorDomains = await getCompetitorDomains({
    userId,
    entity,
  });
  const dataIssues: string[] = [];
  const results = await Promise.all(
    competitorDomains.map((domain) =>
      buildCompetitorPagesResponse({
        domain,
        previousUrls: getStringArrayPayload(entity, "previousUrls"),
        location: getLocation(entity),
        limit: getNumberPayload(entity, "limit", 20),
        login,
        password,
        dataIssues: [],
      }),
    ),
  );

  // Top-level aggregate so CAPABILITY_META's "newPagesCount" score path resolves
  // (the count otherwise only exists per-competitor at competitors[].newPagesCount).
  const newPagesCount = results.reduce(
    (sum, competitor) => sum + (competitor.newPagesCount ?? 0),
    0,
  );

  return {
    output: {
      source: "dataforseo",
      dataIssues,
      newPagesCount,
      competitors: results,
    },
    signals: [],
    costUnits: 1,
  };
};
