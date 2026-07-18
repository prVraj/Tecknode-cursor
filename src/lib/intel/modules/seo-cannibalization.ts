import { buildCannibalizationResponse } from "@/lib/intel/cannibalization";
import { signalSnapshotRepo } from "@/server/db/repos/signal-snapshot.repo";
import type { NewSignal } from "@/server/db/schema";
import type { ModuleRunner } from "../dispatcher";
import {
  asOutput,
  getDataForSeoCredentials,
  getLocation,
  getLocationLabel,
} from "./module-helpers";

const MAX_KEYWORDS = 20;

/**
 * seo_cannibalization — detects keywords where two or more of the org's OWN
 * URLs rank on the same Google SERP (primary entity only). Cannibalization
 * splits clicks + authority across competing pages; the fix is to consolidate
 * or canonicalize them.
 */
export const runSeoCannibalization: ModuleRunner = async ({
  entity,
  userId,
  run,
}) => {
  if (entity.role !== "primary") {
    return {
      output: { skipped: true, reason: "entity is not primary" },
      signals: [],
      costUnits: 0,
    };
  }

  const { login, password } = getDataForSeoCredentials("seo_cannibalization");
  const output = await buildCannibalizationResponse({
    domain: entity.domain,
    location: getLocation(entity),
    locationLabel: getLocationLabel(entity),
    login,
    password,
    maxKeywords: MAX_KEYWORDS,
  });

  const signals: NewSignal[] = [];
  const dedupKey = `seo_cannibalization:${entity.id}`;
  const today = new Date().toISOString().slice(0, 10);

  // Detect keywords that are NEWLY cannibalized vs the previous snapshot.
  const prev = await signalSnapshotRepo.findLatest(
    entity.id,
    "seo_cannibalization",
  );
  const prevKeywords = new Set<string>(
    Array.isArray(prev?.payload?.cannibalized)
      ? (prev.payload.cannibalized as Array<{ keyword: string }>).map(
          (c) => c.keyword,
        )
      : [],
  );
  const newlyCannibalized = output.cannibalized.filter(
    (c) => !prevKeywords.has(c.keyword),
  );

  if (output.cannibalizedCount === 0) {
    signals.push({
      userId,
      subjectEntityId: entity.id,
      capabilityKey: "seo_cannibalization",
      severity: "p3",
      title: `No keyword cannibalization across ${output.keywordsChecked} top keywords`,
      summary: `${entity.domain} has a single ranking URL per keyword in the top 10.`,
      evidence: { runId: run.id, details: { baseline: true } },
      confidence: "0.7",
      dedupKey,
    });
  } else {
    const top = output.cannibalized[0];
    const isNew = newlyCannibalized.length > 0;
    signals.push({
      userId,
      subjectEntityId: entity.id,
      capabilityKey: "seo_cannibalization",
      severity: "p2",
      title: `${output.cannibalizedCount} keyword(s) cannibalized${isNew ? ` (${newlyCannibalized.length} new)` : ""}`,
      summary: top
        ? `e.g. "${top.keyword}" has ${top.urlCount} of your URLs competing in the top 10. Consolidate or canonicalize.`
        : "Multiple of your URLs compete for the same keywords.",
      evidence: {
        runId: run.id,
        details: {
          cannibalizedCount: output.cannibalizedCount,
          newlyCannibalized: newlyCannibalized.map((c) => c.keyword),
          cannibalized: output.cannibalized,
        },
      },
      confidence: "0.8",
      dedupKey: isNew ? `${dedupKey}:new:${today}` : dedupKey,
    });
  }

  return {
    output: asOutput(output),
    signals,
    // 1 ranked-keywords call + up to MAX_KEYWORDS SERP probes (all cached).
    costUnits: output.keywordsChecked + 1,
  };
};
