import {
  buildIndexationHealth,
  type CanonicalPayload,
  type IndexCoveragePayload,
  type NoindexPayload,
  type SitemapPayload,
} from "@/lib/intel/indexation-health";
import type { NewSignal } from "@/server/db/schema";
import type { ModuleRunner } from "../dispatcher";
import { asOutput, readTodaySnapshotPayload } from "./module-helpers";

/**
 * seo_indexation_health — composite 0–100 indexation-health score for the org's
 * own site (primary entity). Rolls up the same-day snapshots of the four index
 * signals (index coverage, noindex, canonical drift, sitemap churn) into a
 * single score + status. Pure DB composite — no network calls, zero cost.
 */
export const runSeoIndexationHealth: ModuleRunner = async ({
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

  const today = new Date().toISOString().slice(0, 10);
  const [indexCoverage, noindex, canonical, sitemap] = await Promise.all([
    readTodaySnapshotPayload<IndexCoveragePayload>(
      entity.id,
      "seo_index_coverage",
      today,
    ),
    readTodaySnapshotPayload<NoindexPayload>(
      entity.id,
      "seo_noindex_alert",
      today,
    ),
    readTodaySnapshotPayload<CanonicalPayload>(
      entity.id,
      "seo_canonical_drift",
      today,
    ),
    readTodaySnapshotPayload<SitemapPayload>(
      entity.id,
      "seo_sitemap_diff",
      today,
    ),
  ]);

  const output = buildIndexationHealth({
    domain: entity.domain,
    indexCoverage,
    noindex,
    canonical,
    sitemap,
  });

  const severity =
    output.status === "critical"
      ? "p1"
      : output.status === "at_risk"
        ? "p2"
        : "p3";

  const signals: NewSignal[] = [
    {
      userId,
      subjectEntityId: entity.id,
      capabilityKey: "seo_indexation_health",
      severity,
      title:
        output.score === null
          ? "Indexation health: no component data yet"
          : `Indexation health: ${output.score}/100 (${output.status})`,
      summary:
        output.issues.length > 0
          ? output.issues.slice(0, 4).join("; ")
          : `Healthy across ${output.componentsAvailable.length} indexation checks.`,
      evidence: {
        runId: run.id,
        details: {
          score: output.score,
          status: output.status,
          components: output.components,
          componentsAvailable: output.componentsAvailable,
        },
      },
      confidence: "0.7",
      dedupKey: `seo_indexation_health:${entity.id}`,
    },
  ];

  return { output: asOutput(output), signals, costUnits: 0 };
};
