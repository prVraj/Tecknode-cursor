import {
  buildSiteHealth,
  type HealthIssue,
  SITE_HEALTH_COMPONENTS,
} from "@/lib/intel/site-health";
import { signalRepo } from "@/server/db/repos/signal.repo";
import { signalSnapshotRepo } from "@/server/db/repos/signal-snapshot.repo";
import type { NewSignal } from "@/server/db/schema";
import type { ModuleRunner } from "../dispatcher";
import { asOutput } from "./module-helpers";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * How far back an issue still counts as open. The component signals run on
 * mixed cadences (daily for error-spike, up to 14d for internal-linking), so a
 * window shorter than the slowest component would silently drop that
 * component's issues and inflate the score.
 */
const OPEN_ISSUE_WINDOW_DAYS = 21;

/**
 * seo_site_health — composite 0–100 technical-health score for the org's own
 * site (issue #386). Pure DB composite over signals we already emit; no network
 * call, zero cost.
 */
export const runSeoSiteHealth: ModuleRunner = async ({
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

  const since = new Date(Date.now() - OPEN_ISSUE_WINDOW_DAYS * MS_PER_DAY);

  const [componentSignals, previous, componentSnapshots] = await Promise.all([
    signalRepo.listByEntityCapabilitiesSince(
      entity.id,
      SITE_HEALTH_COMPONENTS,
      since,
    ),
    signalSnapshotRepo.findLatest(entity.id, "seo_site_health"),
    Promise.all(
      SITE_HEALTH_COMPONENTS.map((key) =>
        signalSnapshotRepo
          .findLatest(entity.id, key)
          .then((snap) => ({ key, snap })),
      ),
    ),
  ]);

  // A component counts as "available" only if it produced a clean snapshot
  // WITHIN the same window we count issues over. Two traps this closes:
  //  - never-run: no snapshot ⇒ not available (else the score reads 100 on a
  //    component that has never contributed data).
  //  - went-stale: a component that ran months ago then broke or was disabled
  //    still has a latest snapshot, but its old issues have aged out of the
  //    window — so it would contribute a perfect 0-penalty score. Bounding
  //    availability by the same window makes availability and issues agree.
  const componentsAvailable = componentSnapshots
    .filter(({ snap }) => {
      if (!snap || snap.hasDataIssues) return false;
      const ageMs =
        Date.now() - new Date(`${snap.capturedDate}T00:00:00Z`).getTime();
      return (
        Number.isFinite(ageMs) && ageMs <= OPEN_ISSUE_WINDOW_DAYS * MS_PER_DAY
      );
    })
    .map(({ key }) => key);

  const issues: HealthIssue[] = componentSignals.map((s) => ({
    capabilityKey: s.capabilityKey,
    severity: s.severity,
    title: s.title,
  }));

  const prevDetails = (previous?.payload ?? {}) as { issueCount?: unknown };
  const output = buildSiteHealth({
    issues,
    componentsAvailable,
    previousScore: numeric(previous?.primaryScore),
    previousIssueCount:
      typeof prevDetails.issueCount === "number"
        ? prevDetails.issueCount
        : null,
  });

  const signals: NewSignal[] = [];
  if (output.score != null) {
    const severity =
      output.status === "critical"
        ? "p1"
        : output.status === "at_risk"
          ? "p2"
          : "p3";

    signals.push({
      userId,
      subjectEntityId: entity.id,
      capabilityKey: "seo_site_health",
      severity,
      title: `Site health: ${output.score}/100 (${output.status})`,
      summary:
        output.topIssues.length > 0
          ? `${output.errors} errors, ${output.warnings} warnings, ${output.notices} notices. Worst: ${output.topIssues[0]?.title}`
          : `No open technical issues across ${output.componentsAvailable.length} checks.`,
      evidence: {
        sourceUrl: `https://${entity.domain}`,
        runId: run.id,
        details: {
          score: output.score,
          status: output.status,
          errors: output.errors,
          warnings: output.warnings,
          notices: output.notices,
          topIssues: output.topIssues,
          componentsAvailable: output.componentsAvailable,
          componentsMissing: output.componentsMissing,
          fixedSinceLast: output.fixedSinceLast,
          newSinceLast: output.newSinceLast,
        },
      },
      confidence: "0.7",
      dedupKey: `seo_site_health:${entity.id}`,
    });
  }

  return {
    output: asOutput({
      ...output,
      domain: entity.domain,
      // Persisted so the NEXT run can compute fixed-vs-new without recounting.
      issueCount: issues.length,
    }),
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
