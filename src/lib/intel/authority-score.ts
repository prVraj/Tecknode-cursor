/**
 * seo_authority_score — one 0–100 domain-strength number, the metric Semrush
 * (Authority Score) and Ahrefs (Domain Rating) lead with (issue #386).
 *
 * Fully derived, zero cost: `seo_backlinks` already fetches DataForSEO's domain
 * rank and stores it as that snapshot's `primaryScore` (its `primaryScoreField`
 * is `summary.rank`). This just rescales it and tracks the trend — no new fetch.
 */

/** DataForSEO's domain rank is 0–1000; Semrush/Ahrefs both present 0–100. */
const RANK_MAX = 1000;
const SCORE_MAX = 100;

/**
 * How stale a backlinks snapshot may be before authority is reported as
 * unknown rather than quietly restating a months-old number as today's.
 * `seo_backlinks` runs weekly (cadenceDays: 7), so two missed cycles + slack.
 */
export const MAX_BACKLINKS_AGE_DAYS = 21;

/**
 * A move of at least this many points is worth alerting on. Authority is a
 * slow metric — day-to-day noise of a point or two is not news, and alerting
 * on it would train people to ignore the signal.
 */
const NOTABLE_DELTA = 3;

export type AuthorityBand =
  | "very_low"
  | "low"
  | "moderate"
  | "strong"
  | "very_strong";

export interface AuthorityScoreOutput {
  /** 0–100, or null when there's no usable backlinks snapshot. */
  authorityScore: number | null;
  /** The raw DataForSEO rank we derived from, for traceability. */
  domainRank: number | null;
  band: AuthorityBand | null;
  /** Points moved since the previous authority snapshot; null on first run. */
  delta: number | null;
  previousScore: number | null;
  dataIssues: string[];
}

export function bandFor(score: number): AuthorityBand {
  if (score >= 81) return "very_strong";
  if (score >= 61) return "strong";
  if (score >= 41) return "moderate";
  if (score >= 21) return "low";
  return "very_low";
}

/** Rescale DataForSEO's 0–1000 rank onto the 0–100 scale, clamped. */
export function rankToScore(rank: number): number {
  const scaled = (rank / RANK_MAX) * SCORE_MAX;
  return Math.round(Math.min(SCORE_MAX, Math.max(0, scaled)));
}

export function buildAuthorityScore(input: {
  /** `seo_backlinks` snapshot's primaryScore (DataForSEO domain rank, 0–1000). */
  domainRank: number | null;
  /** Age of that snapshot in days — stale data must not masquerade as current. */
  backlinksAgeDays: number | null;
  /** Previous `seo_authority_score` snapshot's score, for the delta. */
  previousScore: number | null;
}): AuthorityScoreOutput {
  const { domainRank, backlinksAgeDays, previousScore } = input;
  const dataIssues: string[] = [];

  if (domainRank == null || !Number.isFinite(domainRank)) {
    dataIssues.push("No backlinks snapshot yet — run seo_backlinks first");
    return empty(previousScore, dataIssues);
  }

  // A non-finite age (bad date → NaN) must NOT slip through: `NaN > MAX` is
  // false, so without the finite check an unparseable capturedDate would score
  // stale data as current.
  if (
    backlinksAgeDays != null &&
    (!Number.isFinite(backlinksAgeDays) ||
      backlinksAgeDays > MAX_BACKLINKS_AGE_DAYS)
  ) {
    dataIssues.push(
      `Backlinks data is ${Number.isFinite(backlinksAgeDays) ? `${backlinksAgeDays}d old` : "of unknown age"} (max ${MAX_BACKLINKS_AGE_DAYS}d) — authority not scored`,
    );
    return empty(previousScore, dataIssues);
  }

  const authorityScore = rankToScore(domainRank);
  return {
    authorityScore,
    domainRank,
    band: bandFor(authorityScore),
    delta: previousScore == null ? null : authorityScore - previousScore,
    previousScore,
    dataIssues,
  };
}

function empty(
  previousScore: number | null,
  dataIssues: string[],
): AuthorityScoreOutput {
  return {
    authorityScore: null,
    domainRank: null,
    band: null,
    delta: null,
    previousScore,
    dataIssues,
  };
}

/** A drop worth alerting on — only drops; a rise is good news, not an alert. */
export function isNotableDrop(delta: number | null): boolean {
  return delta != null && delta <= -NOTABLE_DELTA;
}

export function isNotableRise(delta: number | null): boolean {
  return delta != null && delta >= NOTABLE_DELTA;
}
