import type {
  CapabilityKey,
  ConnectorRun,
  NewSignal,
  TrackedEntity,
} from "@/server/db/schema";
import { runBrandLookalikeDomains } from "./modules/brand-lookalike-domains";
import { runBrandPhishing } from "./modules/brand-phishing";
import { runBrandTrademarkAbuse } from "./modules/brand-trademark-abuse";
import { runGeoAccuracyAudit } from "./modules/geo-accuracy-audit";
import { runGeoAiSearchVolume } from "./modules/geo-ai-search-volume";
import { runGeoAlternatives } from "./modules/geo-alternatives";
import { runGeoAnswerPosition } from "./modules/geo-answer-position";
import { runGeoCitationAuthority } from "./modules/geo-citation-authority";
import { runGeoCitationSources } from "./modules/geo-citation-sources";
import { runGeoCitationTaxonomy } from "./modules/geo-citation-taxonomy";
import { runGeoCitationVelocity } from "./modules/geo-citation-velocity";
import { runGeoCitationWhy } from "./modules/geo-citation-why";
import { runGeoCitations } from "./modules/geo-citations";
import { runGeoCoCitations } from "./modules/geo-co-citations";
import { runGeoCompetitorVisibility } from "./modules/geo-competitor-visibility";
import { runGeoContentGap } from "./modules/geo-content-gap";
import { runGeoEngineCitations } from "./modules/geo-engine-citations";
import { runGeoKeywordCitations } from "./modules/geo-keyword-citations";
import { runGeoMentions } from "./modules/geo-mentions";
import { runGeoMentionsGeo } from "./modules/geo-mentions-geo";
import { runGeoPromptResearch } from "./modules/geo-prompt-research";
import { runGeoSentiment } from "./modules/geo-sentiment";
import { runGeoShoppingCitation } from "./modules/geo-shopping-citation";
import { runGeoSocialSignals } from "./modules/geo-social-signals";
import { runGeoTrafficEstimate } from "./modules/geo-traffic-estimate";
import { runGeoTrafficLift } from "./modules/geo-traffic-lift";
import { runGeoVisibilityScore } from "./modules/geo-visibility-score";
import { runGeoYoutubeCitations } from "./modules/geo-youtube-citations";
import { runMentionsBrand, runMentionsKeyword } from "./modules/mentions";
import { runPrNewsCoverage } from "./modules/pr-news-coverage";
import { runSeoAnswerBox } from "./modules/seo-answer-box";
import { runSeoAuthorityScore } from "./modules/seo-authority-score";
import { runSeoBacklinkChanges } from "./modules/seo-backlink-changes";
import { runSeoBacklinks } from "./modules/seo-backlinks";
import { runSeoCannibalization } from "./modules/seo-cannibalization";
import { runSeoCanonicalDrift } from "./modules/seo-canonical-drift";
import { runSeoCompetitorPages } from "./modules/seo-competitor-pages";
import { runSeoContentFreshness } from "./modules/seo-content-freshness";
import { runSeoContentScore } from "./modules/seo-content-score";
import { runSeoCwv } from "./modules/seo-cwv";
import { runSeoErrorSpike } from "./modules/seo-error-spike";
import { runSeoIndexationHealth } from "./modules/seo-indexation-health";
import { runSeoInternalLinking } from "./modules/seo-internal-linking";
import { runSeoInternationalRank } from "./modules/seo-international-rank";
import { runSeoKeywordChanges } from "./modules/seo-keyword-changes";
import { runSeoKeywordGap } from "./modules/seo-keyword-gap";
import { runSeoKeywordIntent } from "./modules/seo-keyword-intent";
import { runSeoLocalRank } from "./modules/seo-local-rank";
import { runSeoNoindexAlert } from "./modules/seo-noindex-alert";
import { runSeoPositionDistribution } from "./modules/seo-position-distribution";
import { runSeoRank } from "./modules/seo-rank";
import { runSeoSerpFeatures } from "./modules/seo-serp-features";
import { runSeoSerpVolatility } from "./modules/seo-serp-volatility";
import { runSeoSiteHealth } from "./modules/seo-site-health";
import { runSeoSitemapDiff } from "./modules/seo-sitemap-diff";
import { runSeoSov } from "./modules/seo-sov";
import { runSeoTopPages } from "./modules/seo-top-pages";
import { runSeoTrafficTrend } from "./modules/seo-traffic-trend";
import { runSeoTrafficValue } from "./modules/seo-traffic-value";
import { runSocialYoutubeMentions } from "./modules/social-youtube-mentions";
import type { SnapshotProvenance } from "./provenance";

export interface ModuleRunContext {
  userId: string;
  entity: TrackedEntity;
  run: ConnectorRun;
}

export interface ModuleRunResult {
  /** Raw fact to persist on the connector_run row. */
  output: Record<string, unknown>;
  /** Zero or more signals to upsert via signalRepo.upsertByDedupKey. */
  signals: NewSignal[];
  /** Cost (in vendor units) for accounting. */
  costUnits?: number;
  /** Optional lineage hints for the daily signal_snapshots payload envelope. */
  snapshotProvenance?: Partial<SnapshotProvenance>;
  /**
   * Override the day (YYYY-MM-DD) this run's `signal_snapshots` row
   * represents. Defaults to the run's wall-clock date. Modules that report on
   * a lagging window (e.g. "yesterday's" revenue) MUST set this to the date
   * the value actually represents — otherwise `capturedDate` drifts one day
   * ahead of the data, which silently corrupts day-of-week-based anomaly
   * detection.
   */
  capturedDate?: string;
}

export type ModuleRunner = (ctx: ModuleRunContext) => Promise<ModuleRunResult>;

/**
 * These 3 capabilities require a Google Search Console connection via
 * Composio, which is out of scope for this migration (all Composio/MCP/OAuth
 * integration infrastructure was intentionally excluded — see Task 1-4
 * migration notes). They remain in `CAPABILITY_KEYS` for schema/catalog
 * parity with the source signal-catalog, but have no runner. Calling
 * `getModuleRunner` for one of these throws a descriptive error that the
 * runner (Task 5d) should catch and record as a `entity_config`-classified
 * connector failure rather than crashing the drain.
 */
const UNIMPLEMENTED_GSC_CAPABILITIES = new Set<CapabilityKey>([
  "seo_content_decay",
  "seo_ctr_anomaly",
  "seo_index_coverage",
]);

const MODULE_RUNNERS: Partial<Record<CapabilityKey, ModuleRunner>> = {
  // ── seo ───────────────────────────────────────────────────────────────
  seo_rank: runSeoRank,
  seo_keyword_gap: runSeoKeywordGap,
  seo_keyword_changes: runSeoKeywordChanges,
  seo_keyword_intent: runSeoKeywordIntent,
  seo_serp_features: runSeoSerpFeatures,
  seo_sov: runSeoSov,
  seo_traffic_trend: runSeoTrafficTrend,
  seo_top_pages: runSeoTopPages,
  seo_backlinks: runSeoBacklinks,
  seo_cwv: runSeoCwv,
  seo_content_score: runSeoContentScore,
  seo_content_freshness: runSeoContentFreshness,
  seo_competitor_pages: runSeoCompetitorPages,
  seo_answer_box: runSeoAnswerBox,
  seo_local_rank: runSeoLocalRank,
  seo_international_rank: runSeoInternationalRank,
  seo_sitemap_diff: runSeoSitemapDiff,
  seo_noindex_alert: runSeoNoindexAlert,
  seo_canonical_drift: runSeoCanonicalDrift,
  seo_error_spike: runSeoErrorSpike,
  seo_internal_linking: runSeoInternalLinking,
  seo_backlink_changes: runSeoBacklinkChanges,
  seo_cannibalization: runSeoCannibalization,
  seo_indexation_health: runSeoIndexationHealth,
  seo_authority_score: runSeoAuthorityScore,
  seo_site_health: runSeoSiteHealth,
  seo_position_distribution: runSeoPositionDistribution,
  seo_traffic_value: runSeoTrafficValue,
  seo_serp_volatility: runSeoSerpVolatility,

  // ── geo ───────────────────────────────────────────────────────────────
  geo_citations: runGeoCitations,
  geo_mentions: runGeoMentions,
  geo_mentions_geo: runGeoMentionsGeo,
  geo_engine_citations: runGeoEngineCitations,
  geo_keyword_citations: runGeoKeywordCitations,
  geo_citation_sources: runGeoCitationSources,
  geo_citation_velocity: runGeoCitationVelocity,
  geo_citation_authority: runGeoCitationAuthority,
  geo_citation_why: runGeoCitationWhy,
  geo_co_citations: runGeoCoCitations,
  geo_accuracy_audit: runGeoAccuracyAudit,
  geo_traffic_estimate: runGeoTrafficEstimate,
  geo_traffic_lift: runGeoTrafficLift,
  geo_competitor_visibility: runGeoCompetitorVisibility,
  geo_visibility_score: runGeoVisibilityScore,
  geo_alternatives: runGeoAlternatives,
  geo_content_gap: runGeoContentGap,
  geo_social_signals: runGeoSocialSignals,
  geo_prompt_research: runGeoPromptResearch,
  geo_youtube_citations: runGeoYoutubeCitations,
  geo_shopping_citation: runGeoShoppingCitation,
  geo_sentiment: runGeoSentiment,
  geo_answer_position: runGeoAnswerPosition,
  geo_citation_taxonomy: runGeoCitationTaxonomy,
  geo_ai_search_volume: runGeoAiSearchVolume,

  // ── mentions / brand protection ──────────────────────────────────────
  mentions_brand: runMentionsBrand,
  mentions_keyword: runMentionsKeyword,
  brand_lookalike_domains: runBrandLookalikeDomains,
  brand_phishing: runBrandPhishing,
  brand_trademark_abuse: runBrandTrademarkAbuse,
  social_youtube_mentions: runSocialYoutubeMentions,
  pr_news_coverage: runPrNewsCoverage,
};

/**
 * Capability → module function. Flat lookup by design.
 *
 * Every `CapabilityKey` MUST eventually resolve except the 3 GSC-dependent
 * capabilities listed in {@link UNIMPLEMENTED_GSC_CAPABILITIES}, which throw a
 * descriptive, catchable error instead of a generic "not wired up" message.
 */
export function getModuleRunner(capability: CapabilityKey): ModuleRunner {
  const runner = MODULE_RUNNERS[capability];
  if (runner) return runner;

  if (UNIMPLEMENTED_GSC_CAPABILITIES.has(capability)) {
    throw new Error(
      `getModuleRunner: "${capability}" requires a Google Search Console connection (Composio), which is out of scope for this migration — no runner is wired up.`,
    );
  }

  throw new Error(
    `getModuleRunner: no module wired up for capability "${capability}"`,
  );
}
