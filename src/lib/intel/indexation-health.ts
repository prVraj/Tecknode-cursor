/**
 * Indexation health — a composite 0–100 score over the four primary-site
 * indexation signals that already run:
 *   • seo_index_coverage  — money pages losing search visibility (deindex proxy)
 *   • seo_noindex_alert    — accidental noindex on money pages
 *   • seo_canonical_drift  — canonicals pointing away from the page itself
 *   • seo_sitemap_diff     — sitemap URL churn
 *
 * Pure DB composite (mirrors geo_visibility_score): it reads the same-day
 * snapshots those modules already produced and rolls them into one health
 * number + status. No network calls, no cost. Missing components are excluded
 * from scoring and noted, so the score reflects only what we could measure.
 */

export type IndexCoveragePayload = {
  indexationRate?: number | null;
  lostPages?: string[];
};
export type NoindexPayload = { noindexCount?: number; noindexPages?: string[] };
export type CanonicalPayload = { driftCount?: number; driftedPages?: string[] };
export type SitemapPayload = { removedUrlCount?: number };

export type IndexationHealthComponent = {
  available: boolean;
  penalty: number;
  detail: string;
};

export type IndexationStatus =
  | "healthy"
  | "minor"
  | "at_risk"
  | "critical"
  | "unknown";

export type IndexationHealthResponse = {
  source: "composite";
  domain: string;
  score: number | null;
  status: IndexationStatus;
  components: Record<string, IndexationHealthComponent>;
  issues: string[];
  componentsAvailable: string[];
  dataIssues: string[];
};

const NOINDEX_PER_PAGE = 10;
const NOINDEX_CAP = 40;
const CANONICAL_PER_PAGE = 5;
const CANONICAL_CAP = 20;
const COVERAGE_WEIGHT = 0.4; // (100 - rate) * weight
const LOST_PER_PAGE = 5;
const LOST_CAP = 20;

function statusForScore(score: number): IndexationStatus {
  if (score >= 90) return "healthy";
  if (score >= 70) return "minor";
  if (score >= 50) return "at_risk";
  return "critical";
}

export function buildIndexationHealth({
  domain,
  indexCoverage,
  noindex,
  canonical,
  sitemap,
}: {
  domain: string;
  indexCoverage: IndexCoveragePayload | null;
  noindex: NoindexPayload | null;
  canonical: CanonicalPayload | null;
  sitemap: SitemapPayload | null;
}): IndexationHealthResponse {
  const components: Record<string, IndexationHealthComponent> = {};
  const issues: string[] = [];
  const dataIssues: string[] = [];
  const available: string[] = [];
  let score = 100;

  // ── noindex (most severe — a noindex'd money page is invisible) ──────────
  if (noindex) {
    available.push("noindex");
    const count = noindex.noindexCount ?? 0;
    const penalty = Math.min(NOINDEX_CAP, count * NOINDEX_PER_PAGE);
    score -= penalty;
    components.noindex = {
      available: true,
      penalty,
      detail: `${count} money page(s) set to noindex`,
    };
    if (count > 0) issues.push(`${count} money page(s) set to noindex`);
  } else {
    components.noindex = {
      available: false,
      penalty: 0,
      detail: "no snapshot",
    };
    dataIssues.push("seo_noindex_alert snapshot unavailable");
  }

  // ── canonical drift ───────────────────────────────────────────────────────
  if (canonical) {
    available.push("canonical");
    const count = canonical.driftCount ?? 0;
    const penalty = Math.min(CANONICAL_CAP, count * CANONICAL_PER_PAGE);
    score -= penalty;
    components.canonical = {
      available: true,
      penalty,
      detail: `${count} page(s) with canonical drift`,
    };
    if (count > 0) issues.push(`${count} page(s) with canonical drift`);
  } else {
    components.canonical = {
      available: false,
      penalty: 0,
      detail: "no snapshot",
    };
    dataIssues.push("seo_canonical_drift snapshot unavailable");
  }

  // ── index coverage (deindex proxy via GSC impressions) ───────────────────
  if (indexCoverage && indexCoverage.indexationRate != null) {
    available.push("indexCoverage");
    const rate = indexCoverage.indexationRate;
    const lost = indexCoverage.lostPages?.length ?? 0;
    const penalty =
      Math.round((100 - rate) * COVERAGE_WEIGHT) +
      Math.min(LOST_CAP, lost * LOST_PER_PAGE);
    score -= penalty;
    components.indexCoverage = {
      available: true,
      penalty,
      detail: `indexation rate ${rate}%, ${lost} page(s) lost visibility`,
    };
    if (rate < 100) issues.push(`indexation rate ${rate}%`);
    if (lost > 0) issues.push(`${lost} money page(s) lost search visibility`);
  } else {
    components.indexCoverage = {
      available: false,
      penalty: 0,
      detail: "no snapshot / GSC not connected",
    };
    dataIssues.push("seo_index_coverage snapshot unavailable");
  }

  // ── sitemap churn (minor — large removals can signal accidental drops) ────
  if (sitemap) {
    available.push("sitemap");
    const removed = sitemap.removedUrlCount ?? 0;
    const penalty = removed >= 10 ? 10 : removed >= 5 ? 5 : 0;
    score -= penalty;
    components.sitemap = {
      available: true,
      penalty,
      detail: `${removed} URL(s) removed from sitemap`,
    };
    if (removed >= 5) issues.push(`${removed} URL(s) removed from sitemap`);
  } else {
    components.sitemap = {
      available: false,
      penalty: 0,
      detail: "no snapshot",
    };
    dataIssues.push("seo_sitemap_diff snapshot unavailable");
  }

  if (available.length === 0) {
    return {
      source: "composite",
      domain,
      score: null,
      status: "unknown",
      components,
      issues,
      componentsAvailable: available,
      dataIssues,
    };
  }

  const finalScore = Math.max(0, Math.min(100, Math.round(score)));
  return {
    source: "composite",
    domain,
    score: finalScore,
    status: statusForScore(finalScore),
    components,
    issues,
    componentsAvailable: available,
    dataIssues,
  };
}
