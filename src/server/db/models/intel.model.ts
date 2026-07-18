import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { user } from "./auth.model";

// ── Capability keys ───────────────────────────────────────────────────────────
// Adding a new module = add a key here + a case in dispatcher.ts + CAPABILITY_META entry.
//
// SCOPE: exactly 64 retained capabilities — 32 seo_*, 25 geo_*, and 7 named
// mentions/brand-protection keys. Every other prefix (audit_/landing_/comp_/
// dev_/ads_/platform_/page_/email_/uptime_/personal_) from the RunAgents
// source is out of scope for Tecknode and MUST NOT be re-added here — the
// `src/lib/intel/signal-scope.test.ts` invariant enforces this at test time.

export const CAPABILITY_KEYS = [
  // ── seo (32) ────────────────────────────────────────────────────────────
  "seo_rank",
  "seo_keyword_gap",
  "seo_keyword_changes",
  "seo_keyword_intent",
  "seo_serp_features",
  "seo_sov",
  "seo_traffic_trend",
  "seo_top_pages",
  "seo_backlinks",
  "seo_cwv",
  "seo_content_score",
  "seo_content_freshness",
  "seo_competitor_pages",
  "seo_answer_box",
  "seo_local_rank",
  "seo_international_rank",
  "seo_sitemap_diff",
  "seo_index_coverage",
  "seo_noindex_alert",
  "seo_canonical_drift",
  "seo_content_decay",
  "seo_ctr_anomaly",
  "seo_error_spike",
  "seo_internal_linking",
  "seo_backlink_changes",
  "seo_cannibalization",
  "seo_indexation_health",
  "seo_authority_score",
  "seo_site_health",
  "seo_position_distribution",
  "seo_traffic_value",
  "seo_serp_volatility",
  // ── geo (25) ────────────────────────────────────────────────────────────
  "geo_citations",
  "geo_mentions",
  "geo_mentions_geo",
  "geo_engine_citations",
  "geo_keyword_citations",
  "geo_citation_sources",
  "geo_citation_velocity",
  "geo_citation_authority",
  "geo_citation_why",
  "geo_co_citations",
  "geo_accuracy_audit",
  "geo_traffic_estimate",
  "geo_traffic_lift",
  "geo_competitor_visibility",
  "geo_visibility_score",
  "geo_alternatives",
  "geo_content_gap",
  "geo_social_signals",
  "geo_prompt_research",
  "geo_youtube_citations",
  "geo_shopping_citation",
  "geo_sentiment",
  "geo_answer_position",
  "geo_citation_taxonomy",
  "geo_ai_search_volume",
  // ── mentions / brand protection (7) ─────────────────────────────────────
  "mentions_brand",
  "mentions_keyword",
  "brand_lookalike_domains",
  "brand_phishing",
  "brand_trademark_abuse",
  "social_youtube_mentions",
  "pr_news_coverage",
] as const;

export type CapabilityKey = (typeof CAPABILITY_KEYS)[number];

// ── Signal categories (derived from capability key prefix) ────────────────────

export const SIGNAL_CATEGORIES = ["seo", "geo", "mentions"] as const;
export type SignalCategory = (typeof SIGNAL_CATEGORIES)[number];

export const SCORE_DIRECTIONS = [
  "higher_is_better",
  "lower_is_better",
] as const;
export type ScoreDirection = (typeof SCORE_DIRECTIONS)[number];

/** Derive category from the capability key prefix. */
export function categoryForCapability(key: CapabilityKey): SignalCategory {
  if (key.startsWith("seo_")) return "seo";
  if (key.startsWith("geo_")) return "geo";
  // mentions_*, brand_*, social_*, pr_* — the four retained mentions/brand
  // protection prefixes.
  return "mentions";
}

// ── Capability metadata ───────────────────────────────────────────────────────
// Single source of truth for labels and score extraction. The intel runner
// dispatches modules in-process via `getModuleRunner(capability)`; there is no
// HTTP layer between scheduler and module, so capability metadata no longer
// carries an `ingestPath`.

export interface CapabilityMeta {
  label: string;
  category: SignalCategory;
  /**
   * Dot-path into the response payload to extract the primary numeric score.
   * Null means no single representative number exists for this signal.
   * Example: "summary.mentionRate", "score", "yourRank"
   */
  primaryScoreField: string | null;
  scoreDirection: ScoreDirection | null;
  /** Enabled for all orgs by default on first setup. */
  defaultEnabled: boolean;
  /**
   * Minimum days between snapshots for this capability. The daily scheduler
   * (`enqueueDailyRuns`) skips a (entity, capability) pair when its newest
   * `signal_snapshots.captured_at` is younger than `cadenceDays`. Lets us hold
   * the daily tick cadence in scheduling but avoid spending API credits to
   * re-fetch data that doesn't change daily (SSL certs, robots.txt, etc).
   *
   * Values:
   *   1   = daily (fast-moving or alert-grade signals)
   *   7   = weekly (most SEO/GEO metrics, expensive LLM probes)
   *   14  = biweekly (docs/sitemap/schema structure)
   *   30  = monthly (compliance, DNS, generator capabilities)
   *
   * Defaults to 1 if unset — a missing value preserves existing behavior.
   */
  cadenceDays: number;
  /**
   * Which tracked-entity role(s) this capability should fan out across.
   *   "any"     — enqueued for both primary and competitor entities (default)
   *   "primary" — enqueued only for the primary brand. Use for signals that
   *               only make sense for the org's own infra (own-site E-E-A-T,
   *               own email DKIM/SPF, own pages' Core Web Vitals) or are
   *               globally identical (ad-platform policy pages).
   *
   * Note: cheap signals where competitor data is legitimately useful — like
   * uptime_* (free DNS/HTTPS probes — "is competitor X down right now?") —
   * stay "any" even though they target the entity's own infra.
   *
   * Defaults to "any" if unset — preserves existing behavior.
   */
  entityScope?: EntityScope;
}

/**
 * Dependency edges ("capabilities whose SAME-DAY snapshot this one reads") are
 * NOT declared here. They live in the signal catalog (`signal-catalog.md` →
 * `signal-catalog.generated.ts`) and are read through
 * `capability-order.getCapabilityProducers`, which is what drives the tiered
 * drain, snapshot provenance, and chat context assembly alike.
 *
 * This used to be a second, hand-maintained `dependsOn` field on CapabilityMeta.
 * It drifted: the catalog declared 42 edges while this listed only 4, and the
 * drain's tier barrier read *this* one — so every geo_* and seo_* dependent
 * raced the producer it was supposed to read. One source of truth only.
 */

export type EntityScope = "any" | "primary";

export const CAPABILITY_META: Record<CapabilityKey, CapabilityMeta> = {
  seo_rank: {
    label: "SEO Rank",
    category: "seo",
    // Volume-weighted average organic position across the tracked keyword
    // portfolio (lower is better). Replaces the old brand-name single-position
    // score, which was ~always #1 and meaningless.
    primaryScoreField: "avgPosition",
    scoreDirection: "lower_is_better",
    defaultEnabled: true,
    cadenceDays: 1,
  },
  seo_keyword_gap: {
    label: "Keyword Gap",
    category: "seo",
    primaryScoreField: "totalGaps",
    scoreDirection: "lower_is_better",
    defaultEnabled: true,
    cadenceDays: 7,
  },
  seo_keyword_changes: {
    label: "Keyword Portfolio Changes",
    category: "seo",
    primaryScoreField: null,
    scoreDirection: null,
    defaultEnabled: true,
    cadenceDays: 1,
  },
  seo_keyword_intent: {
    label: "Keyword Intent",
    category: "seo",
    primaryScoreField: null,
    scoreDirection: null,
    defaultEnabled: true,
    cadenceDays: 30,
  },
  seo_serp_features: {
    label: "SERP Feature Ownership",
    category: "seo",
    primaryScoreField: null,
    scoreDirection: null,
    defaultEnabled: true,
    cadenceDays: 1,
  },
  seo_sov: {
    label: "Share of Voice",
    category: "seo",
    primaryScoreField: "domains.0.relativeSoV",
    scoreDirection: "higher_is_better",
    defaultEnabled: true,
    cadenceDays: 7,
  },
  seo_traffic_trend: {
    label: "Traffic Trend",
    category: "seo",
    primaryScoreField: null,
    scoreDirection: null,
    defaultEnabled: true,
    cadenceDays: 7,
  },
  seo_top_pages: {
    label: "Competitor Top Pages",
    category: "seo",
    primaryScoreField: null,
    scoreDirection: null,
    defaultEnabled: true,
    cadenceDays: 7,
  },
  seo_backlinks: {
    label: "Backlinks",
    category: "seo",
    primaryScoreField: "summary.rank",
    scoreDirection: "higher_is_better",
    defaultEnabled: true,
    cadenceDays: 7,
  },
  seo_cwv: {
    label: "Core Web Vitals",
    category: "seo",
    primaryScoreField: "results.0.lab.performanceScore",
    scoreDirection: "higher_is_better",
    defaultEnabled: true,
    cadenceDays: 7,
    entityScope: "primary",
  },
  seo_content_score: {
    label: "Content Score",
    category: "seo",
    primaryScoreField: "contentScore",
    scoreDirection: "higher_is_better",
    defaultEnabled: true,
    cadenceDays: 7,
  },
  seo_content_freshness: {
    label: "Content Freshness",
    category: "seo",
    primaryScoreField: "pages.0.daysAgo",
    scoreDirection: "lower_is_better",
    defaultEnabled: true,
    cadenceDays: 7,
  },
  seo_competitor_pages: {
    label: "Competitor New Pages",
    category: "seo",
    primaryScoreField: "newPagesCount",
    scoreDirection: null,
    defaultEnabled: true,
    cadenceDays: 7,
  },
  geo_citations: {
    label: "AI Citations",
    category: "geo",
    primaryScoreField: "yourDomainStats.frequency",
    scoreDirection: "higher_is_better",
    defaultEnabled: true,
    cadenceDays: 1,
  },
  geo_mentions: {
    label: "AI Brand Mentions",
    category: "geo",
    primaryScoreField: "summary.mentionRate",
    scoreDirection: "higher_is_better",
    defaultEnabled: true,
    cadenceDays: 1,
  },
  geo_mentions_geo: {
    label: "AI Mentions by Country",
    category: "geo",
    primaryScoreField: null,
    scoreDirection: null,
    defaultEnabled: false,
    cadenceDays: 7,
  },
  geo_engine_citations: {
    label: "Per-Engine Citations",
    category: "geo",
    primaryScoreField: null,
    scoreDirection: null,
    defaultEnabled: true,
    cadenceDays: 7,
  },
  geo_keyword_citations: {
    label: "Keyword Citation Matrix",
    category: "geo",
    primaryScoreField: "overallCitationRate",
    scoreDirection: "higher_is_better",
    defaultEnabled: true,
    cadenceDays: 1,
  },
  geo_citation_sources: {
    label: "Citation Source Patterns",
    category: "geo",
    primaryScoreField: "yourDomainStats.frequency",
    scoreDirection: "higher_is_better",
    defaultEnabled: true,
    cadenceDays: 1,
  },
  geo_citation_velocity: {
    label: "Citation Velocity",
    category: "geo",
    primaryScoreField: "velocityPercent",
    scoreDirection: "higher_is_better",
    defaultEnabled: true,
    cadenceDays: 1,
  },
  geo_citation_authority: {
    label: "Citation Authority",
    category: "geo",
    primaryScoreField: "yourDomainAuthority.authorityWeightedScore",
    scoreDirection: "higher_is_better",
    defaultEnabled: true,
    cadenceDays: 7,
  },
  geo_citation_why: {
    label: "Citation Causality",
    category: "geo",
    primaryScoreField: null,
    scoreDirection: null,
    defaultEnabled: true,
    cadenceDays: 7,
    entityScope: "primary",
  },
  geo_co_citations: {
    label: "Co-Citations",
    category: "geo",
    primaryScoreField: null,
    scoreDirection: null,
    defaultEnabled: true,
    cadenceDays: 1,
  },
  geo_accuracy_audit: {
    label: "AI Accuracy Audit",
    category: "geo",
    primaryScoreField: null,
    scoreDirection: null,
    defaultEnabled: true,
    cadenceDays: 7,
  },
  geo_traffic_estimate: {
    label: "AI Traffic Estimate",
    category: "geo",
    primaryScoreField: "totalEstimatedMonthlyClicks",
    scoreDirection: "higher_is_better",
    defaultEnabled: true,
    cadenceDays: 1,
    entityScope: "primary",
  },
  geo_traffic_lift: {
    label: "AI Traffic Lift Projection",
    category: "geo",
    primaryScoreField: "totalProjectedMonthlyClickLift",
    scoreDirection: "higher_is_better",
    defaultEnabled: false,
    cadenceDays: 7,
    entityScope: "primary",
  },
  geo_competitor_visibility: {
    label: "Competitor AI Visibility",
    category: "geo",
    primaryScoreField: "yourCitationShare",
    scoreDirection: "higher_is_better",
    defaultEnabled: true,
    cadenceDays: 7,
    entityScope: "primary",
  },
  geo_visibility_score: {
    label: "GEO Visibility Score",
    category: "geo",
    primaryScoreField: "score",
    scoreDirection: "higher_is_better",
    defaultEnabled: true,
    cadenceDays: 1,
    entityScope: "primary",
  },
  geo_alternatives: {
    label: "Brand Alternatives",
    category: "geo",
    primaryScoreField: "summary.alternativeNarrativeScore",
    scoreDirection: "higher_is_better",
    defaultEnabled: true,
    cadenceDays: 7,
    entityScope: "primary",
  },
  geo_content_gap: {
    label: "GEO Content Gap",
    category: "geo",
    primaryScoreField: "gapScore",
    scoreDirection: "lower_is_better",
    defaultEnabled: true,
    cadenceDays: 7,
    entityScope: "primary",
  },
  geo_social_signals: {
    label: "Social AI Signals",
    category: "geo",
    primaryScoreField: null,
    scoreDirection: null,
    defaultEnabled: false,
    cadenceDays: 7,
  },
  geo_prompt_research: {
    label: "AI Prompt Research",
    category: "geo",
    primaryScoreField: "aiLikelyCount",
    scoreDirection: "higher_is_better",
    defaultEnabled: false,
    cadenceDays: 7,
  },
  mentions_brand: {
    label: "Brand Mentions",
    category: "mentions",
    primaryScoreField: "aggregates.totalMentions",
    scoreDirection: "higher_is_better",
    defaultEnabled: true,
    cadenceDays: 1,
  },
  mentions_keyword: {
    label: "Keyword Mentions",
    category: "mentions",
    primaryScoreField: "aggregates.totalMentions",
    scoreDirection: "higher_is_better",
    defaultEnabled: true,
    cadenceDays: 1,
  },
  brand_lookalike_domains: {
    label: "Lookalike Domains",
    category: "mentions",
    primaryScoreField: "registeredLookalikeCount",
    scoreDirection: "lower_is_better",
    defaultEnabled: true,
    cadenceDays: 7,
  },
  brand_phishing: {
    label: "Phishing Detection",
    category: "mentions",
    primaryScoreField: "activePhishingCount",
    scoreDirection: "lower_is_better",
    defaultEnabled: false,
    cadenceDays: 1,
  },
  brand_trademark_abuse: {
    label: "Trademark Abuse",
    category: "mentions",
    primaryScoreField: "infringementCount",
    scoreDirection: "lower_is_better",
    defaultEnabled: false,
    cadenceDays: 7,
  },
  seo_answer_box: {
    label: "SERP Answer Box Ownership",
    category: "seo",
    primaryScoreField: "yourSnippetOwnershipRate",
    scoreDirection: "higher_is_better",
    defaultEnabled: true,
    cadenceDays: 7,
  },
  seo_local_rank: {
    label: "Local SEO Rank",
    category: "seo",
    primaryScoreField: "localPackPosition",
    scoreDirection: "lower_is_better",
    defaultEnabled: false,
    cadenceDays: 7,
  },
  seo_international_rank: {
    label: "International SERP Rankings",
    category: "seo",
    primaryScoreField: "avgInternationalRank",
    scoreDirection: "lower_is_better",
    defaultEnabled: false,
    cadenceDays: 7,
  },
  geo_youtube_citations: {
    label: "YouTube AI Citations",
    category: "geo",
    primaryScoreField: "yourYoutubeCitationCount",
    scoreDirection: "higher_is_better",
    defaultEnabled: false,
    cadenceDays: 7,
  },
  geo_shopping_citation: {
    label: "Shopping Citations",
    category: "geo",
    primaryScoreField: "shoppingCitationRate",
    scoreDirection: "higher_is_better",
    defaultEnabled: false,
    cadenceDays: 7,
  },
  geo_sentiment: {
    label: "AI Sentiment Score",
    category: "geo",
    primaryScoreField: "sentimentScore",
    scoreDirection: "higher_is_better",
    defaultEnabled: true,
    cadenceDays: 1,
    // Reads the same-day geo_mentions snapshot — declared in signal-catalog.md
    // (`dependsOn`), the single source of truth that drives the tiered drain.
  },
  geo_answer_position: {
    label: "AI Answer Position",
    category: "geo",
    primaryScoreField: "avgListRank",
    scoreDirection: "lower_is_better",
    defaultEnabled: true,
    cadenceDays: 1,
    // Reads the same-day geo_mentions snapshot — declared in signal-catalog.md
    // (`dependsOn`), the single source of truth that drives the tiered drain.
  },
  geo_citation_taxonomy: {
    label: "Citation Source Taxonomy",
    category: "geo",
    // Breakdown-only, like geo_citation_why / geo_co_citations. An "earned
    // share" score isn't obviously directional (is press better than docs?)
    // and would rest on an uncurated rules map. Revisit with real data.
    primaryScoreField: null,
    scoreDirection: null,
    defaultEnabled: true,
    cadenceDays: 1,
    // Reads the same-day geo_citations snapshot — declared in signal-catalog.md
    // (`dependsOn`), the single source of truth that drives the tiered drain.
  },
  geo_ai_search_volume: {
    label: "AI Search Volume",
    category: "geo",
    primaryScoreField: "totalAiSearchVolume",
    scoreDirection: "higher_is_better",
    defaultEnabled: false,
    // The metric is monthly-granularity upstream (the API returns a 12-month
    // trend), so daily polling would re-bill for identical data.
    cadenceDays: 7,
    // Competitors carry no tracked keywords; `getKeywords` would fall back to
    // the brand name and bill a flat request fee for one meaningless lookup.
    entityScope: "primary",
  },
  social_youtube_mentions: {
    label: "YouTube Brand Mentions",
    category: "mentions",
    primaryScoreField: "videoCount",
    scoreDirection: "higher_is_better",
    defaultEnabled: true,
    cadenceDays: 1,
  },
  pr_news_coverage: {
    label: "News & Media Coverage",
    category: "mentions",
    primaryScoreField: "newsArticleCount",
    scoreDirection: "higher_is_better",
    defaultEnabled: true,
    cadenceDays: 1,
  },
  seo_sitemap_diff: {
    label: "Sitemap Changes",
    category: "seo",
    primaryScoreField: "totalCount",
    scoreDirection: null,
    defaultEnabled: true,
    // Structural; own-site so more responsive than the competitor variant (14).
    cadenceDays: 7,
  },
  seo_index_coverage: {
    label: "Index Coverage",
    category: "seo",
    primaryScoreField: "indexationRate",
    scoreDirection: "higher_is_better",
    defaultEnabled: true,
    // Alert-grade deindex detection, zero cost (Composio GSC).
    cadenceDays: 1,
  },
  seo_noindex_alert: {
    label: "Accidental Noindex",
    category: "seo",
    primaryScoreField: "noindexCount",
    scoreDirection: "lower_is_better",
    defaultEnabled: true,
    // Catch a bad noindex deploy fast; zero cost (plain fetch).
    cadenceDays: 1,
  },
  seo_canonical_drift: {
    label: "Canonical Drift",
    category: "seo",
    primaryScoreField: "driftCount",
    scoreDirection: "lower_is_better",
    defaultEnabled: true,
    // Alert-grade; zero cost (plain fetch).
    cadenceDays: 1,
  },
  seo_content_decay: {
    label: "Content Decay",
    category: "seo",
    primaryScoreField: "decayedCount",
    scoreDirection: "lower_is_better",
    defaultEnabled: true,
    // GSC clicks when connected, else DataForSEO per-page traffic; weekly so a
    // MoM-scale drop is visible across snapshots.
    cadenceDays: 7,
  },
  seo_ctr_anomaly: {
    label: "CTR Anomaly",
    category: "seo",
    primaryScoreField: "anomalyCount",
    scoreDirection: "lower_is_better",
    defaultEnabled: false,
    // GSC-only (CTR has no DataForSEO equivalent); no-ops until GSC connected.
    cadenceDays: 7,
  },
  seo_error_spike: {
    label: "404 / Redirect Errors",
    category: "seo",
    primaryScoreField: "brokenCount",
    scoreDirection: "lower_is_better",
    defaultEnabled: true,
    // Firecrawl map (1 credit) + free HEAD probes; weekly.
    cadenceDays: 7,
  },
  seo_internal_linking: {
    label: "Internal Linking Gaps",
    category: "seo",
    primaryScoreField: "orphanCount",
    scoreDirection: "lower_is_better",
    defaultEnabled: false,
    // Firecrawl crawl (~40 credits); biweekly to bound cost.
    cadenceDays: 14,
  },
  seo_backlink_changes: {
    label: "Backlink Gains / Losses",
    category: "seo",
    primaryScoreField: "summary.referringDomains",
    scoreDirection: "higher_is_better",
    // Plan-gated on the DataForSEO Backlinks API subscription — off by default
    // until the plan is enabled (see docs/signals-deferred.md).
    defaultEnabled: false,
    cadenceDays: 7,
  },
  seo_cannibalization: {
    label: "Keyword Cannibalization",
    category: "seo",
    primaryScoreField: "cannibalizedCount",
    scoreDirection: "lower_is_better",
    defaultEnabled: true,
    cadenceDays: 7,
  },
  seo_indexation_health: {
    label: "Indexation Health",
    category: "seo",
    primaryScoreField: "score",
    scoreDirection: "higher_is_better",
    // Pure DB composite over the four index signals; zero cost.
    defaultEnabled: true,
    cadenceDays: 1,
  },
  seo_authority_score: {
    label: "Authority Score",
    category: "seo",
    primaryScoreField: "authorityScore",
    scoreDirection: "higher_is_better",
    defaultEnabled: true,
    // Weekly: authority is a slow metric, and its source (`seo_backlinks`) only
    // refreshes weekly — running daily would just restate the same number.
    cadenceDays: 7,
  },
  seo_site_health: {
    label: "Site Health",
    category: "seo",
    primaryScoreField: "score",
    scoreDirection: "higher_is_better",
    defaultEnabled: true,
    cadenceDays: 1,
    entityScope: "primary",
  },
  seo_position_distribution: {
    label: "Position Distribution",
    category: "seo",
    primaryScoreField: "topTen",
    scoreDirection: "higher_is_better",
    defaultEnabled: true,
    cadenceDays: 1,
  },
  seo_traffic_value: {
    label: "Traffic Value",
    category: "seo",
    primaryScoreField: "monthlyValueUsd",
    scoreDirection: "higher_is_better",
    defaultEnabled: true,
    cadenceDays: 1,
  },
  seo_serp_volatility: {
    label: "SERP Volatility",
    category: "seo",
    primaryScoreField: "volatility",
    scoreDirection: "lower_is_better",
    defaultEnabled: true,
    cadenceDays: 1,
  },
};

// ── Other constants ───────────────────────────────────────────────────────────

export const TRACKED_ENTITY_ROLES = ["primary", "competitor"] as const;
export type TrackedEntityRole = (typeof TRACKED_ENTITY_ROLES)[number];

export const SIGNAL_SEVERITIES = ["p0", "p1", "p2", "p3"] as const;
export type SignalSeverity = (typeof SIGNAL_SEVERITIES)[number];

export const CONNECTOR_RUN_STATUSES = [
  "pending",
  "running",
  "succeeded",
  "failed",
] as const;
export type ConnectorRunStatus = (typeof CONNECTOR_RUN_STATUSES)[number];

// ── tracked_entities ──────────────────────────────────────────────────────────

export interface TrackedEntityPayload {
  socials?: Partial<{
    twitter: string;
    linkedin: string;
    youtube: string;
    github: string;
  }>;
  /**
   * Social discovery lifecycle state for competitor entities.
   * Set to "pending" on competitor creation, updated to "complete" or "failed"
   * by discoverCompetitorSocials(). Undefined for primary entities.
   */
  discoveryStatus?: "pending" | "complete" | "failed";
  notes?: string;
  watchedPaths?: string[];
  keywords?: string[]; // brand search prompts like "best ai video editor"
  location?: string; // e.g. "United States", "United Kingdom"
  /** Last time we tried to resolve socials.twitter — negative-cache marker so
   *  the mentions runner doesn't re-run a paid lookup every scan when none exists. */
  socialsResolvedAt?: string;
  /**
   * Robots.txt generation preferences. Carried over from RunAgents; the
   * `page_robots_txt` capability itself is out of scope for Tecknode's
   * 64-capability set (see `signal-scope.test.ts`) — revisit whether this
   * field is still needed once Task 5c confirms no retained module reads it.
   */
  robotsPreferences?: Record<string, "allow" | "block">;
  crawlDelay?: number;
  disallowPaths?: string[];
  sitemapUrl?: string;
  /** IndexNow remediation key (32-hex). Generated by setupIndexNow; the user
   *  hosts it at https://<host>/<key>.txt. Primary entities only. */
  indexNowKey?: string;
  /** ISO timestamp set once verifyIndexNow confirms the key file is reachable. */
  indexNowKeyVerifiedAt?: string;
}

export const trackedEntities = pgTable(
  "tracked_entities",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role", { enum: TRACKED_ENTITY_ROLES }).notNull(),
    domain: text("domain").notNull(),
    brandName: text("brand_name"),
    payload: jsonb("payload")
      .$type<TrackedEntityPayload>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("tracked_entities_user_domain_uidx").on(
      table.userId,
      table.domain,
    ),
    index("tracked_entities_user_idx").on(table.userId),
  ],
);

export type TrackedEntity = typeof trackedEntities.$inferSelect;
export type NewTrackedEntity = typeof trackedEntities.$inferInsert;

// ── connector_runs ────────────────────────────────────────────────────────────

export interface ConnectorRunOutput {
  [key: string]: unknown;
}

export const connectorRuns = pgTable(
  "connector_runs",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    entityId: text("entity_id")
      .notNull()
      .references(() => trackedEntities.id, { onDelete: "cascade" }),
    capabilityKey: text("capability_key", { enum: CAPABILITY_KEYS }).notNull(),
    connectorKey: text("connector_key").notNull(),
    status: text("status", { enum: CONNECTOR_RUN_STATUSES })
      .notNull()
      .default("pending"),
    /** The intel tick that last *enqueued* or *drained* this row. References
     *  `intel_ticks.id`. Nullable for rows older than this column. Overwritten
     *  on each touch so dashboards can answer "what did this tick do?" by
     *  joining `connector_runs WHERE tick_id = X`. */
    tickId: text("tick_id"),
    idempotencyKey: text("idempotency_key").notNull(),
    startedAt: timestamp("started_at"),
    finishedAt: timestamp("finished_at"),
    costUnits: numeric("cost_units", { precision: 10, scale: 4 }),
    output: jsonb("output").$type<ConnectorRunOutput | null>(),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("connector_runs_idem_uidx").on(table.idempotencyKey),
    index("connector_runs_user_idx").on(table.userId),
    index("connector_runs_entity_idx").on(table.entityId),
    index("connector_runs_status_idx").on(table.status),
    // Serves the drain's `WHERE status='pending' ORDER BY created_at LIMIT n`
    // so the FIFO scan stays index-ordered as the table grows.
    index("connector_runs_status_created_idx").on(
      table.status,
      table.createdAt,
    ),
    // Serves the admin dashboard's "rollup by tick" queries.
    index("connector_runs_tick_id_idx").on(table.tickId),
  ],
);

export type ConnectorRun = typeof connectorRuns.$inferSelect;
export type NewConnectorRun = typeof connectorRuns.$inferInsert;

// ── intel_ticks ───────────────────────────────────────────────────────────────
// One row per `enqueueDailyRuns()` invocation (cron or manual). Inserted at the
// START of every tick so even a no-op tick (everything already enqueued, nothing
// pending to drain) shows up on the admin dashboard. Stats updated at end.

export const INTEL_TICK_SOURCES = ["cron", "manual"] as const;
export type IntelTickSource = (typeof INTEL_TICK_SOURCES)[number];

export const intelTicks = pgTable(
  "intel_ticks",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    source: text("source", { enum: INTEL_TICK_SOURCES }).notNull(),
    /** User who triggered a manual tick. Null for cron. Lets the dashboard
     *  filter "what did this user's ticks do?" without scanning connector_runs. */
    triggerUserId: text("trigger_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    startedAt: timestamp("started_at").defaultNow().notNull(),
    finishedAt: timestamp("finished_at"),
    /** Counts captured at end-of-tick from the in-memory tally. Provide a
     *  default of 0 so a tick crashed mid-flight still has a sane row. */
    reclaimedGhosts: integer("reclaimed_ghosts").notNull().default(0),
    orgsScanned: integer("orgs_scanned").notNull().default(0),
    entitiesScanned: integer("entities_scanned").notNull().default(0),
    enqueued: integer("enqueued").notNull().default(0),
    skippedAlreadyEnqueued: integer("skipped_already_enqueued")
      .notNull()
      .default(0),
    /** Skipped because last snapshot is younger than `CAPABILITY_META[k].cadenceDays`. */
    skippedByCadence: integer("skipped_by_cadence").notNull().default(0),
    /** Skipped because capability has `entityScope: "primary"` and the entity
     *  is a competitor (or vice versa for future scopes). */
    skippedByEntityScope: integer("skipped_by_entity_scope")
      .notNull()
      .default(0),
    processed: integer("processed").notNull().default(0),
    succeeded: integer("succeeded").notNull().default(0),
    failed: integer("failed").notNull().default(0),
    skipped: integer("skipped").notNull().default(0),
    drainTimedOut: boolean("drain_timed_out").notNull().default(false),
    drainLimit: integer("drain_limit"),
    drainConcurrency: integer("drain_concurrency"),
    errorMessage: text("error_message"),
  },
  (table) => [
    index("intel_ticks_started_at_idx").on(table.startedAt),
    index("intel_ticks_trigger_user_idx").on(table.triggerUserId),
  ],
);

export type NewIntelTick = typeof intelTicks.$inferInsert;

// ── signal_snapshots ──────────────────────────────────────────────────────────
// Time-series store for captured signal data. One row per (entity, capability, day).
// connector_runs.output stores the raw execution log; this table is optimised
// for dashboard queries, sparklines, and WoW comparisons.

export const signalSnapshots = pgTable(
  "signal_snapshots",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    entityId: text("entity_id")
      .notNull()
      .references(() => trackedEntities.id, { onDelete: "cascade" }),
    /** Nullable — manual API calls won't have an associated run. */
    runId: text("run_id").references(() => connectorRuns.id, {
      onDelete: "set null",
    }),
    capabilityKey: text("capability_key", { enum: CAPABILITY_KEYS }).notNull(),
    category: text("category", { enum: SIGNAL_CATEGORIES }).notNull(),
    capturedAt: timestamp("captured_at").defaultNow().notNull(),
    /** UTC calendar date — used for daily dedup and chart x-axis bucketing. */
    capturedDate: date("captured_date").notNull(),
    /**
     * Primary numeric metric for this signal, normalized to a common scale
     * where possible (0–100 for scores/rates; raw value for traffic/counts).
     * Null when no single representative number exists (e.g. keyword lists).
     */
    primaryScore: numeric("primary_score", { precision: 12, scale: 2 }),
    scoreDirection: text("score_direction", {
      enum: SCORE_DIRECTIONS,
    }).$type<ScoreDirection>(),
    /** Full API response payload for this capability. */
    payload: jsonb("payload").notNull().$type<Record<string, unknown>>(),
    /** True if the payload contained non-empty dataIssues. */
    hasDataIssues: boolean("has_data_issues").notNull().default(false),
  },
  (table) => [
    // Core time-series query: "last N days for entity X, capability Y"
    index("signal_snapshots_entity_cap_date_idx").on(
      table.entityId,
      table.capabilityKey,
      table.capturedDate,
    ),
    // Category tab queries: "all GEO signals for user X in last 30 days"
    index("snapshots_user_category_date_idx").on(
      table.userId,
      table.category,
      table.capturedDate,
    ),
    // Latest-per-capability lookup
    index("signal_snapshots_entity_cap_idx").on(
      table.entityId,
      table.capabilityKey,
    ),
    // Scheduler cadence check: `WHERE user_id = ? GROUP BY entity_id,
    // capability_key` runs once per tick per user. Without this index Postgres
    // would table-scan signal_snapshots — fine today, painful as data grows.
    index("signal_snapshots_user_entity_cap_idx").on(
      table.userId,
      table.entityId,
      table.capabilityKey,
    ),
    // One snapshot per (entity, capability, UTC day) — prevents duplicate daily runs
    uniqueIndex("signal_snapshots_daily_uidx").on(
      table.entityId,
      table.capabilityKey,
      table.capturedDate,
    ),
  ],
);

export type SignalSnapshot = typeof signalSnapshots.$inferSelect;
export type NewSignalSnapshot = typeof signalSnapshots.$inferInsert;

// ── signals (alerts) ─────────────────────────────────────────────────────────

export interface SignalEvidence {
  sourceUrl?: string;
  runId: string;
  /** ID of the previous `connector_runs` row (the "before" side of the diff). */
  beforeRunId?: string;
  /** Stable content hash before the observed change. */
  beforeHash?: string;
  afterHash?: string;
  /** Bounded (~2KB) serialized delta for downstream "show what changed" surfaces. */
  diffSnippet?: string;
  details?: Record<string, unknown>;
}

export const signals = pgTable(
  "signals",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    subjectEntityId: text("subject_entity_id")
      .notNull()
      .references(() => trackedEntities.id, { onDelete: "cascade" }),
    capabilityKey: text("capability_key", { enum: CAPABILITY_KEYS }).notNull(),
    severity: text("severity", { enum: SIGNAL_SEVERITIES })
      .notNull()
      .default("p2"),
    title: text("title").notNull(),
    summary: text("summary"),
    evidence: jsonb("evidence").$type<SignalEvidence>().notNull(),
    /** 0.00 – 1.00 — single-source signals capped ~0.75 until multi-source dedup. */
    confidence: numeric("confidence", { precision: 3, scale: 2 })
      .notNull()
      .default("0.75"),
    dedupKey: text("dedup_key").notNull(),
    firstSeenAt: timestamp("first_seen_at").defaultNow().notNull(),
    lastSeenAt: timestamp("last_seen_at").defaultNow().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("signals_dedup_uidx").on(table.dedupKey),
    index("signals_user_created_idx").on(table.userId, table.createdAt),
    index("signals_entity_idx").on(table.subjectEntityId),
    index("signals_capability_idx").on(table.capabilityKey),
  ],
);

export type Signal = typeof signals.$inferSelect;
export type NewSignal = typeof signals.$inferInsert;

// ── user_intel_settings ───────────────────────────────────────────────────────

export type EnabledCapabilities = Partial<Record<CapabilityKey, boolean>>;

/** Default capabilities enabled on first setup — lightweight, no expensive APIs. */
export const DEFAULT_ENABLED_CAPABILITIES: EnabledCapabilities =
  Object.fromEntries(
    CAPABILITY_KEYS.map((key) => [key, CAPABILITY_META[key].defaultEnabled]),
  ) as EnabledCapabilities;

/**
 * Capabilities run immediately after onboarding so the dashboard isn't empty for
 * a brand-new user. A deliberately small, fast, cheap subset of the defaults —
 * the rest (and competitors) fill in on the next daily tick. Spans SEO/GEO/
 * Mentions so the first feed feels representative. Must stay a subset of the
 * default-enabled set, and each runs fine on a `primary` entity. Tune freely.
 */
export const FIRST_RUN_CAPABILITIES: CapabilityKey[] = [
  "seo_rank", // DataForSEO — fast
  "geo_visibility_score", // largely computed — cheap
  "mentions_brand", // fast keyword-search scan
];

export const userIntelSettings = pgTable("user_intel_settings", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  enabledCapabilities: jsonb("enabled_capabilities")
    .$type<EnabledCapabilities>()
    .notNull()
    .default(DEFAULT_ENABLED_CAPABILITIES),
  // Per-org monthly (calendar-month, UTC) spend cap on background connector
  // API usage, in micro-USD. NULL = fall back to the platform default
  // (`DEFAULT_ORG_MONTHLY_BUDGET_MICRO_USD`). The daily scheduler skips an org
  // once its month-to-date `api_usage_events` spend reaches this — a safety
  // net against a runaway auth/quota-fail loop draining paid provider credits.
  costCapMicroUsd: bigint("cost_cap_micro_usd", { mode: "bigint" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export type UserIntelSettings = typeof userIntelSettings.$inferSelect;
export type NewUserIntelSettings = typeof userIntelSettings.$inferInsert;

// ── signal feedback (user 👍/👎 on a signal) ─────────────────────────────────

export const SIGNAL_FEEDBACK_RATINGS = ["up", "down"] as const;
export type SignalFeedbackRating = (typeof SIGNAL_FEEDBACK_RATINGS)[number];

/** Reasons a user can attach to a 👎 (optional). */
export const SIGNAL_FEEDBACK_REASONS = [
  "not_relevant",
  "inaccurate",
  "not_actionable",
] as const;
export type SignalFeedbackReason = (typeof SIGNAL_FEEDBACK_REASONS)[number];

export const signalFeedback = pgTable(
  "signal_feedback",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    signalId: text("signal_id")
      .notNull()
      .references(() => signals.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    rating: text("rating", { enum: SIGNAL_FEEDBACK_RATINGS }).notNull(),
    /** Only meaningful for a "down" rating; null otherwise. */
    reason: text("reason", { enum: SIGNAL_FEEDBACK_REASONS }),
    note: text("note"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    // One feedback row per user per signal — submit upserts / toggles it.
    uniqueIndex("signal_feedback_signal_user_uidx").on(
      table.signalId,
      table.userId,
    ),
    index("signal_feedback_signal_idx").on(table.signalId),
    index("signal_feedback_user_idx").on(table.userId),
  ],
);

export type SignalFeedback = typeof signalFeedback.$inferSelect;
export type NewSignalFeedback = typeof signalFeedback.$inferInsert;
