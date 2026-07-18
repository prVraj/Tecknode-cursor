import type { CapabilityKey, SignalSeverity } from "@/server/db/schema";

/**
 * seo_site_health — one 0–100 technical-health number, the second metric
 * Semrush/Ahrefs lead with (issue #386).
 *
 * Rolls up the technical SEO signals we already emit rather than re-crawling
 * anything: pure DB composite, zero cost.
 *
 * It reads those capabilities' SIGNALS (bucketed by severity) rather than their
 * payloads. Six modules mean six payload shapes, and a composite coupled to all
 * six would break whenever any one of them changed a field name. Severity is the
 * one contract they already share — and it maps directly onto the
 * Errors/Warnings/Notices grouping the UI wants.
 */

/** The technical signals that constitute "site health". */
export const SITE_HEALTH_COMPONENTS = [
  "seo_error_spike",
  "seo_canonical_drift",
  "seo_noindex_alert",
  "seo_cwv",
  "seo_internal_linking",
  "seo_indexation_health",
] as const satisfies readonly CapabilityKey[];

/**
 * Points deducted per open issue, by severity. Errors dominate deliberately: a
 * single p0 (site unindexable, CWV failing) should visibly move the score, while
 * a pile of p3 notices should not drag a healthy site into the red.
 */
const PENALTY: Record<SignalSeverity, number> = {
  p0: 25,
  p1: 15,
  p2: 5,
  p3: 1,
};

export type HealthStatus = "healthy" | "at_risk" | "critical";

export interface HealthIssue {
  capabilityKey: string;
  severity: SignalSeverity;
  title: string;
}

export interface SiteHealthOutput {
  /** 0–100, or null when no component has reported yet. */
  score: number | null;
  status: HealthStatus | null;
  /** p0 + p1 */
  errors: number;
  /** p2 */
  warnings: number;
  /** p3 */
  notices: number;
  /** Which of the six components actually had data this run. */
  componentsAvailable: string[];
  componentsMissing: string[];
  /** Worst-first, capped — the "what's actually wrong" list for the UI. */
  topIssues: HealthIssue[];
  /** Issue counts vs the previous run: the before→after the issue asks for. */
  fixedSinceLast: number | null;
  newSinceLast: number | null;
  previousScore: number | null;
  dataIssues: string[];
}

const MAX_LISTED_ISSUES = 8;

const SEVERITY_ORDER: Record<SignalSeverity, number> = {
  p0: 0,
  p1: 1,
  p2: 2,
  p3: 3,
};

export function statusFor(score: number): HealthStatus {
  if (score < 50) return "critical";
  if (score < 80) return "at_risk";
  return "healthy";
}

export function buildSiteHealth(input: {
  /** Open signals from the component capabilities, this entity, recent window. */
  issues: HealthIssue[];
  /** Which components reported at all — absent ones can't be scored. */
  componentsAvailable: string[];
  previousScore: number | null;
  /** Issue count at the previous run, to derive fixed-vs-new. */
  previousIssueCount: number | null;
}): SiteHealthOutput {
  const { issues, componentsAvailable, previousScore, previousIssueCount } =
    input;

  const componentsMissing = SITE_HEALTH_COMPONENTS.filter(
    (c) => !componentsAvailable.includes(c),
  );
  const dataIssues: string[] = [];

  if (componentsAvailable.length === 0) {
    dataIssues.push(
      "No component signals yet — site health needs at least one technical SEO signal to have run",
    );
    return {
      score: null,
      status: null,
      errors: 0,
      warnings: 0,
      notices: 0,
      componentsAvailable,
      componentsMissing,
      topIssues: [],
      fixedSinceLast: null,
      newSinceLast: null,
      previousScore,
      dataIssues,
    };
  }

  if (componentsMissing.length > 0) {
    // Score anyway, but say so: a 100 computed from one of six components is
    // not the same claim as a 100 computed from all six.
    dataIssues.push(
      `Scored on ${componentsAvailable.length}/${SITE_HEALTH_COMPONENTS.length} components (missing: ${componentsMissing.join(", ")})`,
    );
  }

  const errors = issues.filter(
    (i) => i.severity === "p0" || i.severity === "p1",
  ).length;
  const warnings = issues.filter((i) => i.severity === "p2").length;
  const notices = issues.filter((i) => i.severity === "p3").length;

  const penalty = issues.reduce((sum, i) => sum + PENALTY[i.severity], 0);
  const score = Math.max(0, Math.min(100, 100 - penalty));

  const topIssues = [...issues]
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
    .slice(0, MAX_LISTED_ISSUES);

  // Net movement only. Without stable per-issue identity across runs we can't
  // honestly claim WHICH issues were fixed, so we report the net delta and
  // don't dress it up as more than it is.
  const delta =
    previousIssueCount == null ? null : issues.length - previousIssueCount;

  return {
    score,
    status: statusFor(score),
    errors,
    warnings,
    notices,
    componentsAvailable,
    componentsMissing,
    topIssues,
    fixedSinceLast: delta == null ? null : Math.max(0, -delta),
    newSinceLast: delta == null ? null : Math.max(0, delta),
    previousScore,
    dataIssues,
  };
}
