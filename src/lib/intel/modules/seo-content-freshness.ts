import { buildContentFreshnessResponse } from "@/lib/intel/content-freshness";
import type { ModuleRunner } from "../dispatcher";
import { asOutput, getEntityUrls, requireEnv } from "./module-helpers";

export const runSeoContentFreshness: ModuleRunner = async ({ entity }) => {
  // Fail fast (with the capability tag) if Firecrawl isn't configured — the
  // shared cached scrape() reads the key from env itself.
  requireEnv("FIRECRAWL_API_KEY", "seo_content_freshness");
  const openrouterKey = requireEnv(
    "OPENROUTER_API_KEY",
    "seo_content_freshness",
  );
  const dataIssues: string[] = [];
  const output = await buildContentFreshnessResponse({
    urls: getEntityUrls(entity),
    openrouterKey,
    dataIssues,
  });

  return { output: asOutput(output), signals: [], costUnits: 2 };
};
