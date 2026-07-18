import {
  buildAuthorityScore,
  isNotableDrop,
  isNotableRise,
} from "@/lib/intel/authority-score";
import { signalSnapshotRepo } from "@/server/db/repos/signal-snapshot.repo";
import type { NewSignal } from "@/server/db/schema";
import type { ModuleRunner } from "../dispatcher";
import { asOutput } from "./module-helpers";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * seo_authority_score — 0–100 domain authority (issue #386).
 *
 * Derived from the DataForSEO domain rank `seo_backlinks` already stores as its
 * snapshot `primaryScore`. Pure DB composite — no network call, zero cost.
 *
 * Runs for competitors as well as the primary: the head-to-head authority
 * column on the competitor board is half the value of the metric.
 */
export const runSeoAuthorityScore: ModuleRunner = async ({
  entity,
  userId,
  run,
}) => {
  const [backlinks, previous] = await Promise.all([
    signalSnapshotRepo.findLatest(entity.id, "seo_backlinks"),
    signalSnapshotRepo.findLatest(entity.id, "seo_authority_score"),
  ]);

  const domainRank = numeric(backlinks?.primaryScore);
  const backlinksAgeDays = backlinks
    ? Math.floor(
        (Date.now() -
          new Date(`${backlinks.capturedDate}T00:00:00Z`).getTime()) /
          MS_PER_DAY,
      )
    : null;

  const output = buildAuthorityScore({
    domainRank: backlinks?.hasDataIssues ? null : domainRank,
    backlinksAgeDays,
    previousScore: numeric(previous?.primaryScore),
  });

  const signals: NewSignal[] = [];
  const dedupKey = `seo_authority_score:${entity.id}`;

  if (output.authorityScore != null) {
    const { authorityScore, delta, band } = output;
    // Only a DROP is alert-worthy at p2 — authority rising is good news, and a
    // steady score is just the tracking baseline.
    const severity = isNotableDrop(delta) ? "p2" : "p3";
    const title = isNotableDrop(delta)
      ? `Authority score dropped ${Math.abs(delta ?? 0)} pts to ${authorityScore}/100`
      : isNotableRise(delta)
        ? `Authority score up ${delta} pts to ${authorityScore}/100`
        : `Authority score: ${authorityScore}/100 (${band})`;

    signals.push({
      userId,
      subjectEntityId: entity.id,
      capabilityKey: "seo_authority_score",
      severity,
      title,
      summary: `Domain authority for ${entity.domain} is ${authorityScore}/100 (${band}), derived from a DataForSEO domain rank of ${output.domainRank}/1000.`,
      evidence: {
        sourceUrl: `https://${entity.domain}`,
        runId: run.id,
        details: {
          authorityScore,
          domainRank: output.domainRank,
          band,
          delta,
          previousScore: output.previousScore,
        },
      },
      confidence: "0.8",
      dedupKey,
    });
  }

  return {
    output: asOutput({ ...output, domain: entity.domain }),
    signals,
    costUnits: 0,
  };
};

/** `primaryScore` is a numeric column — Drizzle hands it back as a string. */
function numeric(value: unknown): number | null {
  if (value == null) return null;
  const n = Number.parseFloat(String(value));
  return Number.isFinite(n) ? n : null;
}
