import type { NormalizedMention } from "./types";

/**
 * Reach / impressions estimation (#22).
 *
 * Real impressions only exist on a few platforms — for the rest we estimate,
 * the same way Brand24 ("estimated reach") and Awario ("collective reach") do.
 * Every estimate is tagged with its `source` so the number is never presented
 * as if it were measured.
 *
 * Model (first match wins):
 *  1. actual          — platform returned a real impressions/views number
 *                        (X impression_count, YouTube viewCount, SO view_count)
 *  2. from_followers   — followers × FOLLOWER_REACH_FACTOR
 *                        (a post organically reaches a fraction of followers)
 *  3. from_engagement  — total engagement × ENGAGEMENT_TO_REACH
 *                        (back-calc from a typical ~2% engagement rate)
 *  4. unknown          — no signal at all → 0
 */

export type ReachSource =
  | "actual"
  | "from_followers"
  | "from_engagement"
  | "unknown";

export type ReachEstimate = { value: number; source: ReachSource };

/** Conservative: assume an organic post is seen by ~10% of followers. */
const FOLLOWER_REACH_FACTOR = 0.1;
/** ~2% of people who see a post engage → reach ≈ engagement × 50. */
const ENGAGEMENT_TO_REACH = 50;

export function estimateReach(m: NormalizedMention): ReachEstimate {
  const impressions = m.engagement.impressions;
  if (typeof impressions === "number" && impressions > 0) {
    return { value: impressions, source: "actual" };
  }

  const followers = m.author.followerCount;
  if (typeof followers === "number" && followers > 0) {
    return {
      value: Math.round(followers * FOLLOWER_REACH_FACTOR),
      source: "from_followers",
    };
  }

  const engagement =
    (m.engagement.score ?? 0) +
    (m.engagement.comments ?? 0) +
    (m.engagement.shares ?? 0);
  if (engagement > 0) {
    return {
      value: engagement * ENGAGEMENT_TO_REACH,
      source: "from_engagement",
    };
  }

  return { value: 0, source: "unknown" };
}
