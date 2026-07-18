# Signal Catalog

> **Source of truth** for runtime capabilities (64 entries, 1:1 with `CAPABILITY_KEYS`).
> Edit this file and run `bun run signals:gen` to regenerate `signal-catalog.generated.ts`.
> CI fails on drift.
>
> Pruned from the RunAgents source catalog to the 64 retained capabilities
> (32 seo_*, 25 geo_*, 7 mentions/brand) for the Tecknode migration.
> `groupedWith`/`dependsOn` references to out-of-scope capabilities were
> stripped during pruning.

**Schema per entry**:
- H2 header: `## <capabilityKey> — <name>`
- One paragraph: human-friendly description (one line, no markdown).
- Bulleted key-value list, in this exact order: category, source, costPerCallUsd, costNote, groupedWith, dependsOn, runFrequency, cached, importanceToRevenue.
- `dependsOn`: upstream capabilities whose snapshots or probe artifacts this signal reads; `[]` for standalone producers.
- Product-surface fields (doc-only, ignored by the generator): surface, trendViz, verdict, longTermValue.

**Product-surface legend** (doc-only):
- surface: cockpit | trends | feed | evidence | report | archive (combine with `+`)
- trendViz: spark | delta_dots | last_check | bars | before_after | countdown | ring | tabs | none
- verdict: hero | alert | keep | evidence | merge:<key> | archive | propose

`importanceToRevenue` here is the **default** baked into the file. Live overrides land in the `signal_overrides` table via `/admin/signals`.

### Proposed signals — competitor-parity roadmap (not yet implemented)

> Doc-only shortlist (intentionally NOT `##` entries, so the generator ignores them and parity stays 1:1). Surfaced during competitor-parity research: GEO stats vs Profound/Otterly/Peec (#384), competitor-tracking packaging vs Klue/Crayon (#385), SEO monitoring vs Semrush/Ahrefs (#386), Firehose mentions breadth (#387), and indexing+email vs ContentKing/LittleWarden/MXToolbox/EasyDMARC/GlockApps (#389). Promote to real `## <key>` entries + `CAPABILITY_KEYS` when built. All proposed signals below **cache history** (they trend); each linked issue specs UI + cache + trend per signal.
>
> **Existing-signal changes queued:** #386: `seo_internal_linking` → default-on bi-monthly; `seo_error_spike` → add redirect chains/loops + broken external links. #389: `email_blacklist_monitor` → daily + listed/delisted diff alerts; `uptime_domain_dns` → add NS/IP/MX change detection; **Fix-it button** → stop implying Google resubmission (IndexNow = Bing/Yandex/Naver/Seznam only, verified at indexnow.org); indexing alerts → incident lifecycle (auto-resolve + batching); IndexNow → conditional auto-submit (Triggers×Conditions).
>
> **Derived vs Independent** (new classification, should also be back-filled on the 99 existing entries): **Derived** = computed from another signal's same-day snapshot via `readTodaySnapshotPayload` (no own fetch); **Independent** = runs its own external fetch/probe. Most packaging signals below are Derived.
>
> **Personal-data signals (#392, vs June/Amplitude/Datafast)** derive from the connected analytics/payment connectors (GA4/Stripe/PostHog/etc) via a generic **anomaly engine** (Amplitude recipe: 99% CI, ~120d training, volume gate ≥100/day ×15/30, MAD fallback). They need a NEW `personal` SignalCategory (+ VALID_CATEGORIES + CATEGORY_WEIGHTS). Connectors ESP + Paddle added in #391. Deferred: Google Ads, Vercel/Netlify (later/skip), CRM, full visitor-ID attribution (v2).

| Proposed key | What | Derived/Indep | Source | surface | trendViz | Priority | As found in competitor |
|---|---|---|---|---|---|---|---|
| geo_used_vs_cited | Retrieval rate vs citation rate | Independent | DataForSEO `ai_opt_llm_ment_top_domains` (links_scope) | evidence | before_after | alert | Peec |
| comp_relevance_rank | Rank competitor moves P0/P1/P2 with Fact/Impact/Action | Derived | all signals + signal_feedback (deterministic base + LLM judge) | cockpit (Top Moves) | bars | **hero** | Taken from Klue |
| comp_profile | Always-current cited competitor profile synthesis | Derived | all comp_* + geo_competitor_visibility + dev_github + Knowledge Hub | trends (board header) | ring | keep | Taken from Crayon |
| comp_swot | SWOT deliverable (template) | Derived | comp_pricing_diff, comp_seo, geo_competitor_visibility, customers, community | evidence (template) | none | keep | Taken from Crayon (Sparks) |
| comp_product_diff | Our-vs-their feature/product diff | Derived | comp_product_launch, docs_diff, page_launch, pricing_diff | evidence (template) | none | keep | Taken from Klue |
| comp_objections | Objection → response cards | Derived | comp_review_sentiment, comparison, pricing_diff + Knowledge Hub | evidence (battlecard) | none | keep | Taken from Klue |
| comp_differentiators | Differentiator cards | Derived | comp_hero_diff, customers, trust, geo_competitor_visibility + Knowledge Hub | evidence (battlecard) | none | keep | Taken from Crayon |
| comp_review_sentiment | G2/Capterra/Trustpilot sentiment + themes | Independent (ingest) + Derived (aggregate) | Trustpilot API + G2/Capterra scrape → classify (ai-mentions pattern) | trends (board section) | line | alert | Taken from Klue/Crayon |
| seo_authority_score | Domain Authority 0-100 (headline domain-strength number) | Derived | normalize DataForSEO domain rank already in seo_backlinks | trends | spark (ring headline) | **hero** | Taken from Semrush (Authority Score) / Ahrefs (Domain Rating) |
| seo_site_health | Site Health 0-100 (composite of technical signals) | Derived | composite over error_spike/canonical/noindex/cwv/internal_linking/indexation_health | trends+cockpit | ring | **hero** | Taken from Semrush/Ahrefs (Site Health) |
| seo_position_distribution | Keyword count by rank bucket (top3/4-10/11-20/…) over time | Derived | seo_rank | trends | bars (stacked area) | keep | Taken from Semrush/Ahrefs |
| seo_serp_volatility | SERP-flux index ("you vs a Google update") | Derived | day-over-day flux across tracked-keyword SERPs | trends+cockpit | spark (gauge) | keep | Taken from Semrush (Sensor) |
| seo_traffic_value | $ value of organic traffic (traffic × CPC) | Derived | seo_traffic_trend × CPC (DataForSEO) | trends | spark | keep | Taken from Semrush/Ahrefs |
| seo_toxic_backlinks | Spam / negative-SEO risk flag on backlink spikes | Independent | DataForSEO backlinks_bulk_spam_score | cockpit+trends | spark | alert | Taken from Semrush (Toxicity) |
| seo_index_verdict | Google's ACTUAL per-URL index state on money pages (verdict + Google-chosen canonical) | Independent | GSC URL Inspection API (~2k/day quota, money pages only) | cockpit+trends | before_after (per page) + spark (indexedRate) | **hero** | Our edge deepened — neither ContentKing nor Little Warden uses it |
| seo_hreflang_drift | hreflang tags on money pages changed/broken | Independent | direct fetch (copy seo_canonical_drift) | cockpit | before_after | alert | Taken from ContentKing/Little Warden |
| seo_schema_break | structured data (JSON-LD) on money pages gone or unparseable | Independent | direct fetch + parse | cockpit | before_after | alert | Taken from ContentKing |
| email_dmarc_reports | DMARC RUA aggregate ingestion — "who is sending as you" (per-source pass %, Verified/Forwarder/Threat/Unknown) | Independent (inbound ingest) | customer points rua= at our endpoint; XML parse | cockpit+trends | spark (compliance %) + before_after (new source) | **hero** | Taken from MXToolbox/EasyDMARC/GlockApps |
| email_postmaster | Google Postmaster reputation, spam rate, auth % | Independent | OAuth pull from customer's Postmaster account | trends | spark + 0.3% threshold alert | keep | Taken from EasyDMARC/GlockApps |
| email_compliance | Gmail/Yahoo bulk-sender compliance checklist (DMARC + spam rate + one-click unsub) | Derived | composite over email_deliverability + email_postmaster | cockpit | last_check + flip alert | alert | Verification-pass find (no competitor brief flagged it) |
| email_tls_rpt | TLS-RPT report ingestion (delivery/TLS failures) | Independent (inbound ingest) | same parser pattern as RUA | evidence | before_after | alert | Taken from EasyDMARC |
| revenue_pulse | Daily MRR / new / churn + anomaly (the founder heartbeat number) | Derived | Stripe/LS/Razorpay/Gumroad/Paddle (connected) + anomaly engine | cockpit+trends | spark | **hero** | Taken from Amplitude (anomaly) / Baremetrics |
| payment_failures | Failed-payment / involuntary-churn spike | Derived | payment connectors + anomaly | cockpit | before_after | alert | Painkiller (uncontested) |
| traffic_channel_anomaly | GA4 per-channel session anomaly (volume-gated, ≥100/day ×15/30) | Derived | GA4 (connected) + anomaly engine | trends+cockpit | spark | alert | Taken from Amplitude |
| traffic_revenue_divergence | Traffic up + signups/conversions flat = a junk channel | Derived | GA4 × Stripe (connected, no customer code change) | cockpit | before_after | **hero** | Taken from Datafast (insight as a push) |
| activation_regression | PostHog activation-milestone conversion drop WoW | Derived | PostHog (connected) | trends+cockpit | delta_dots | alert | Taken from June (template as a monitor) |

---

## seo_rank — SEO Rank

Current SERP position for the brand on tracked keywords.

- category: seo
- source: DataForSEO /v3/serp/google/organic/live/advanced
- costPerCallUsd: 0.0006
- costNote: 1 DataForSEO SERP task
- groupedWith: [seo_sov, seo_traffic_trend, seo_top_pages, seo_answer_box, seo_serp_features, seo_keyword_changes]
- dependsOn: []
- runFrequency: daily
- cached: true
- importanceToRevenue: unknown
- surface: cockpit+trends
- trendViz: spark
- verdict: hero
- longTermValue: at-risk traffic on the keyword (x GSC/GA4), not fabricated $

## seo_keyword_gap — Keyword Gap

Keywords competitors rank for that the brand does not.

- category: seo
- source: DataForSEO /v3/keyword_gap
- costPerCallUsd: 0.0006
- costNote: 1 DataForSEO task
- groupedWith: []
- dependsOn: []
- runFrequency: weekly
- cached: true
- importanceToRevenue: unknown
- surface: cockpit
- trendViz: before_after
- verdict: alert
- longTermValue: rank gaps ordered by traffic potential

## seo_keyword_changes — Keyword Portfolio Changes

Gains/losses in keyword rankings day-over-day across the brand's portfolio.

- category: seo
- source: DataForSEO /v3/serp (delta vs prior signal_snapshot)
- costPerCallUsd: 0
- costNote: Reuses SERP fetch + DB delta
- groupedWith: [seo_rank]
- dependsOn: [seo_rank]
- runFrequency: daily
- cached: true
- importanceToRevenue: unknown
- surface: evidence
- trendViz: tabs
- verdict: evidence
- longTermValue: day-over-day delta shown under rank

## seo_keyword_intent — Keyword Intent

Classifies tracked keywords by intent (transactional, informational, navigational).

- category: seo
- source: DataForSEO /v3/keyword_intent
- costPerCallUsd: 0.0006
- costNote: 1 DataForSEO task
- groupedWith: []
- dependsOn: []
- runFrequency: monthly
- cached: true
- importanceToRevenue: unknown
- surface: report
- trendViz: none
- verdict: evidence
- longTermValue: intent mix in the audit report

## seo_serp_features — SERP Feature Ownership

Counts featured snippets, knowledge panels, image packs the brand owns.

- category: seo
- source: Reuses seo_rank SERP fetch (feature_flags parsing)
- costPerCallUsd: 0
- costNote: Reuses SERP payload
- groupedWith: [seo_rank]
- dependsOn: [seo_rank]
- runFrequency: daily
- cached: true
- importanceToRevenue: unknown
- surface: evidence
- trendViz: tabs
- verdict: evidence
- longTermValue: SERP-feature ownership sub-metric under rank

## seo_sov — Share of Voice

Relative SERP visibility share vs competitors across the keyword universe.

- category: seo
- source: Reuses seo_rank SERP fetch (aggregate across keywords)
- costPerCallUsd: 0
- costNote: Reuses SERP payload
- groupedWith: [seo_rank]
- dependsOn: [seo_rank]
- runFrequency: weekly
- cached: true
- importanceToRevenue: unknown
- surface: evidence
- trendViz: tabs
- verdict: evidence
- longTermValue: share-of-voice sub-metric under rank

## seo_traffic_trend — Traffic Trend

Estimated organic traffic WoW/MoM trend for the brand domain.

- category: seo
- source: DataForSEO /v3/dataforseo_labs/google/historical_serps
- costPerCallUsd: 0.0006
- costNote: 1 DataForSEO task
- groupedWith: []
- dependsOn: []
- runFrequency: weekly
- cached: true
- importanceToRevenue: unknown
- surface: report
- trendViz: delta_dots
- verdict: evidence
- longTermValue: organic-traffic estimate in the report

## seo_top_pages — Competitor Top Pages

Competitor's highest-traffic pages in organic search.

- category: seo
- source: DataForSEO /v3/dataforseo_labs/google/relevant_pages
- costPerCallUsd: 0.0006
- costNote: 1 DataForSEO task per competitor
- groupedWith: []
- dependsOn: []
- runFrequency: weekly
- cached: true
- importanceToRevenue: unknown
- surface: evidence
- trendViz: before_after
- verdict: evidence
- longTermValue: competitor top pages -> competitor evidence

## seo_backlinks — Backlinks

Domain authority + backlink count + referring domain count for the brand.

- category: seo
- source: DataForSEO /v3/backlinks/summary
- costPerCallUsd: 0.0006
- costNote: 1 DataForSEO task
- groupedWith: []
- dependsOn: []
- runFrequency: weekly
- cached: true
- importanceToRevenue: unknown
- surface: report
- trendViz: delta_dots
- verdict: evidence
- longTermValue: authority metric in report (0-1000, not health-normalized)

## seo_cwv — Core Web Vitals

Google PageSpeed Insights: LCP, FID/INP, CLS lab and field data.

- category: seo
- source: Google PageSpeed Insights API + Chrome UX Report
- costPerCallUsd: 0
- costNote: Free Google API (rate-limited)
- groupedWith: []
- dependsOn: []
- runFrequency: weekly
- cached: true
- importanceToRevenue: unknown
- surface: report
- trendViz: delta_dots
- verdict: evidence
- longTermValue: PageSpeed score in the report

## seo_content_score — Content Score

On-page content quality + SEO optimization score for the brand's top pages.

- category: seo
- source: DataForSEO /v3/content_analysis/summary
- costPerCallUsd: 0.0006
- costNote: 1 DataForSEO task
- groupedWith: []
- dependsOn: []
- runFrequency: weekly
- cached: true
- importanceToRevenue: unknown
- surface: report
- trendViz: delta_dots
- verdict: evidence
- longTermValue: on-page content quality in the report

## seo_content_freshness — Content Freshness

Age of brand's top-ranking pages — days since last meaningful update.

- category: seo
- source: Firecrawl /v1/scrape (last-modified extraction)
- costPerCallUsd: 0.005
- costNote: ~5 Firecrawl scrapes for top pages
- groupedWith: []
- dependsOn: []
- runFrequency: weekly
- cached: true
- importanceToRevenue: unknown
- surface: report
- trendViz: last_check
- verdict: evidence
- longTermValue: days-since-update in the report

## seo_competitor_pages — Competitor New Pages

New content URLs published by competitors since last snapshot.

- category: seo
- source: Firecrawl /v1/map (delta vs prior signal_snapshot)
- costPerCallUsd: 0.005
- costNote: 1 Firecrawl map per competitor
- groupedWith: []
- dependsOn: []
- runFrequency: weekly
- cached: true
- importanceToRevenue: unknown
- surface: evidence
- trendViz: before_after
- verdict: evidence
- longTermValue: new competitor pages -> competitor evidence

## seo_sitemap_diff — Sitemap Changes

Own-site URL structure diff vs prior snapshot — new sections, removed pages, depth shifts.

- category: seo
- source: Firecrawl /v1/map (delta vs prior signal_snapshot)
- costPerCallUsd: 0.005
- costNote: 1 Firecrawl map call
- groupedWith: []
- dependsOn: []
- runFrequency: weekly
- cached: true
- importanceToRevenue: unknown
- surface: cockpit
- trendViz: before_after
- verdict: alert
- longTermValue: new URLs -> IndexNow

## seo_index_coverage — Index Coverage

Deindex / index-coverage detection for the org's money pages, using GSC impressions as a coverage proxy.

- category: seo
- source: Composio GSC Search Analytics (page impressions)
- costPerCallUsd: 0
- costNote: zero marginal cost via connected GSC account
- groupedWith: [seo_noindex_alert, seo_canonical_drift]
- dependsOn: [seo_noindex_alert]
- runFrequency: daily
- cached: false
- importanceToRevenue: unknown
- surface: cockpit
- trendViz: spark
- verdict: alert
- longTermValue: at-risk clicks per deindexed money page

## seo_noindex_alert — Accidental Noindex

Detects money pages that started returning noindex (a bad deploy can silently drop pages from search).

- category: seo
- source: Direct HTTP fetch of money pages (meta robots / X-Robots-Tag)
- costPerCallUsd: 0
- costNote: plain HTTP fetch, no vendor cost
- groupedWith: [seo_canonical_drift]
- dependsOn: [seo_canonical_drift]
- runFrequency: daily
- cached: false
- importanceToRevenue: unknown
- surface: cockpit
- trendViz: before_after
- verdict: alert
- longTermValue: +Fix-it; name the deploy that introduced it

## seo_canonical_drift — Canonical Drift

Detects money pages whose canonical URL changed or points off-page, which can deindex the page.

- category: seo
- source: Direct HTTP fetch of money pages (canonical link / header)
- costPerCallUsd: 0
- costNote: plain HTTP fetch, no vendor cost
- groupedWith: [seo_noindex_alert]
- dependsOn: [seo_noindex_alert]
- runFrequency: daily
- cached: false
- importanceToRevenue: unknown
- surface: cockpit
- trendViz: before_after
- verdict: alert
- longTermValue: +Fix-it; generate the canonical fix

## seo_content_decay — Content Decay

Own-site pages losing traffic vs the prior snapshot (>20% drop). Uses GSC clicks when connected, else DataForSEO per-page estimated organic traffic.

- category: seo
- source: Composio GSC clicks; DataForSEO ranked_keywords (per-page) fallback
- costPerCallUsd: 0.01
- costNote: 0 with GSC; 1 DataForSEO ranked_keywords call when GSC absent
- groupedWith: [seo_ctr_anomaly, seo_index_coverage]
- dependsOn: []
- runFrequency: weekly
- cached: true
- importanceToRevenue: unknown
- surface: cockpit
- trendViz: delta_dots
- verdict: alert
- longTermValue: at-risk clicks per decaying page

## seo_ctr_anomaly — CTR Anomaly

Own-site pages whose click-through rate fell sharply while impressions held steady (title/meta/SERP-appeal problem, not a ranking loss). GSC-only.

- category: seo
- source: Composio GSC Search Analytics (page impressions + clicks → CTR)
- costPerCallUsd: 0
- costNote: zero marginal cost via connected GSC account; no-ops without GSC
- groupedWith: [seo_content_decay, seo_index_coverage]
- dependsOn: [seo_content_decay]
- runFrequency: weekly
- cached: false
- importanceToRevenue: unknown
- surface: cockpit
- trendViz: delta_dots
- verdict: alert
- longTermValue: draft the title/meta rewrite

## seo_error_spike — 404 / Redirect Errors

Broken (4xx/5xx) and redirecting (3xx) URLs across the primary site's own discoverable URLs, with spike detection vs the prior snapshot.

- category: seo
- source: Firecrawl /v1/map inventory + HEAD status probes
- costPerCallUsd: 0.005
- costNote: 1 Firecrawl map call; HEAD probes are free
- groupedWith: [seo_sitemap_diff]
- dependsOn: [seo_sitemap_diff]
- runFrequency: weekly
- cached: true
- importanceToRevenue: unknown
- surface: cockpit
- trendViz: delta_dots
- verdict: alert
- longTermValue: safe fix-it list for 4xx/5xx spikes

## seo_internal_linking — Internal Linking Gaps

Crawls the primary site, builds an inbound-link graph, and flags orphan pages (no internal links) and under-linked money pages.

- category: seo
- source: Firecrawl /v1/crawl (per-page links graph)
- costPerCallUsd: 0.04
- costNote: ~40 Firecrawl crawl page-credits
- groupedWith: []
- dependsOn: []
- runFrequency: biweekly
- cached: false
- importanceToRevenue: unknown
- surface: cockpit
- trendViz: before_after
- verdict: keep
- longTermValue: flag orphaned money pages (x GSC top pages)

## seo_answer_box — SERP Answer Box Ownership

Share of branded queries where the brand owns the answer box / featured snippet.

- category: seo
- source: Reuses seo_rank SERP fetch (answer_box parsing)
- costPerCallUsd: 0
- costNote: Reuses SERP payload
- groupedWith: [seo_rank]
- dependsOn: [seo_rank]
- runFrequency: weekly
- cached: true
- importanceToRevenue: unknown
- surface: evidence
- trendViz: tabs
- verdict: evidence
- longTermValue: snippet-ownership sub-metric under rank

## seo_local_rank — Local SEO Rank

Position in Google Local Pack for local-intent keywords.

- category: seo
- source: DataForSEO /v3/serp/google/maps + /v3/serp/google/local
- costPerCallUsd: 0.0012
- costNote: 2 DataForSEO tasks
- groupedWith: []
- dependsOn: []
- runFrequency: weekly
- cached: true
- importanceToRevenue: unknown
- surface: trends
- trendViz: delta_dots
- verdict: keep
- longTermValue: enable per ICP (local intent)

## seo_international_rank — International SERP Rankings

Average SERP rank across multiple country locales for the same keywords.

- category: seo
- source: DataForSEO /v3/serp/google/organic (per-locale fan-out)
- costPerCallUsd: 0.003
- costNote: ~5 SERP tasks (one per locale)
- groupedWith: []
- dependsOn: []
- runFrequency: weekly
- cached: true
- importanceToRevenue: unknown
- surface: trends
- trendViz: delta_dots
- verdict: keep
- longTermValue: enable per ICP (international)

## geo_citations — AI Citations

Citation frequency of the brand's domain in answers from Claude, GPT, Gemini, Perplexity.

- category: geo
- source: OpenRouter (Claude Sonnet + others via OR routing)
- costPerCallUsd: 0.02
- costNote: Multi-engine LLM probe; ~2k–4k tokens total
- groupedWith: [geo_mentions, geo_engine_citations, geo_keyword_citations, geo_citation_sources, geo_co_citations, geo_citation_velocity]
- dependsOn: []
- runFrequency: daily
- cached: true
- importanceToRevenue: unknown
- surface: trends
- trendViz: spark
- verdict: hero
- longTermValue: per-prompt causality -> content brief to win the cite

## geo_mentions — AI Brand Mentions

Rate at which AI answers mention the brand by name (not just cite its domain).

- category: geo
- source: Reuses geo_citations probe responses
- costPerCallUsd: 0
- costNote: Parses geo_citations responses
- groupedWith: [geo_citations]
- dependsOn: [geo_citations]
- runFrequency: daily
- cached: true
- importanceToRevenue: unknown
- surface: trends
- trendViz: spark
- verdict: merge:geo_citations
- longTermValue: mention rate shown under citations

## geo_mentions_geo — AI Mentions by Country

Geographic distribution of AI mentions across locale-tagged probes.

- category: geo
- source: OpenRouter (Claude Sonnet) — per-locale probes
- costPerCallUsd: 0.04
- costNote: ~5 locale-tagged probes
- groupedWith: []
- dependsOn: []
- runFrequency: weekly
- cached: true
- importanceToRevenue: unknown
- surface: evidence
- trendViz: tabs
- verdict: evidence
- longTermValue: per-country breakdown; niche toggle

## geo_engine_citations — Per-Engine Citations

Citation breakdown by engine (OpenAI vs Anthropic vs Google vs Perplexity).

- category: geo
- source: Reuses geo_citations probe (per-engine grouping)
- costPerCallUsd: 0
- costNote: Parses geo_citations responses
- groupedWith: [geo_citations]
- dependsOn: []
- runFrequency: daily
- cached: true
- importanceToRevenue: unknown
- surface: evidence
- trendViz: tabs
- verdict: merge:geo_citations
- longTermValue: per-engine tab under citations

## geo_keyword_citations — Keyword Citation Matrix

Citation rate keyed by each tracked keyword × each engine.

- category: geo
- source: Reuses geo_citations probe (keyword × engine pivot)
- costPerCallUsd: 0
- costNote: Parses geo_citations responses
- groupedWith: [geo_citations]
- dependsOn: [geo_citations]
- runFrequency: daily
- cached: true
- importanceToRevenue: unknown
- surface: evidence
- trendViz: tabs
- verdict: merge:geo_citations
- longTermValue: keyword x engine tab under citations

## geo_citation_sources — Citation Source Patterns

Which third-party domains AI engines cite alongside the brand.

- category: geo
- source: Reuses geo_citations probe (cited-URL extraction)
- costPerCallUsd: 0
- costNote: Parses geo_citations responses
- groupedWith: [geo_citations]
- dependsOn: [geo_citations]
- runFrequency: daily
- cached: true
- importanceToRevenue: unknown
- surface: evidence
- trendViz: tabs
- verdict: merge:geo_citations
- longTermValue: cited-domains tab under citations

## geo_citation_velocity — Citation Velocity

Week-over-week percent change in citation count.

- category: geo
- source: DB analysis over historical signal_snapshots
- costPerCallUsd: 0
- costNote: Pure DB analysis
- groupedWith: [geo_citations]
- dependsOn: [geo_citations]
- runFrequency: daily
- cached: true
- importanceToRevenue: unknown
- surface: evidence
- trendViz: tabs
- verdict: merge:geo_citations
- longTermValue: WoW velocity under citations

## geo_citation_authority — Citation Authority

Authority-weighted citation score (cites from high-DR domains count more).

- category: geo
- source: geo_citations sources + DataForSEO /v3/backlinks (cited-domain DR)
- costPerCallUsd: 0.005
- costNote: Reuses geo_citations + small DataForSEO lookup
- groupedWith: []
- dependsOn: [geo_citations]
- runFrequency: weekly
- cached: true
- importanceToRevenue: unknown
- surface: evidence
- trendViz: tabs
- verdict: evidence
- longTermValue: authority-weighted view under citations

## geo_citation_why — Citation Causality

Why the brand is cited — context, framing, sentiment around each mention.

- category: geo
- source: Reuses geo_citations probe + OpenRouter (Sonnet classification)
- costPerCallUsd: 0.01
- costNote: Small LLM classification pass
- groupedWith: []
- dependsOn: [geo_citations]
- runFrequency: weekly
- cached: true
- importanceToRevenue: unknown
- surface: evidence
- trendViz: tabs
- verdict: evidence
- longTermValue: citation context/causality under citations

## geo_co_citations — Co-Citations

Brands cited together with this brand in AI answers (reveals AI's perceived peer set).

- category: geo
- source: Reuses geo_citations probe (brand-entity extraction)
- costPerCallUsd: 0
- costNote: Parses geo_citations responses
- groupedWith: [geo_citations]
- dependsOn: [geo_citations]
- runFrequency: daily
- cached: true
- importanceToRevenue: unknown
- surface: evidence
- trendViz: tabs
- verdict: merge:geo_citations
- longTermValue: perceived peer-set under citations

## geo_accuracy_audit — AI Accuracy Audit

Fact-checks AI claims about the brand against a ground-truth corpus.

- category: geo
- source: OpenRouter (Claude Sonnet) + ground-truth comparison
- costPerCallUsd: 0.03
- costNote: LLM judge pass per claim
- groupedWith: []
- dependsOn: []
- runFrequency: weekly
- cached: true
- importanceToRevenue: unknown
- surface: evidence
- trendViz: none
- verdict: evidence
- longTermValue: fact-check pass; inspectable on drill-down

## geo_traffic_estimate — AI Traffic Estimate

Estimated monthly clicks from AI-generated citations to the brand's domain.

- category: geo
- source: Composite — citation rate × estimated AI query volume
- costPerCallUsd: 0
- costNote: Pure DB analysis over signal_snapshots
- groupedWith: []
- dependsOn: [geo_citations]
- runFrequency: daily
- cached: true
- importanceToRevenue: unknown
- surface: evidence
- trendViz: spark
- verdict: evidence
- longTermValue: show as at-risk AI clicks, not $

## geo_traffic_lift — AI Traffic Lift Projection

Projected additional monthly AI-search clicks from realistic GEO optimizations (position lift, coverage, competitor parity).

- category: geo
- source: Derived — projection over geo_traffic_estimate citation positions
- costPerCallUsd: 0
- costNote: Reuses same-day geo_traffic_estimate snapshot; re-probes only if absent
- groupedWith: [geo_traffic_estimate]
- dependsOn: [geo_traffic_estimate, geo_competitor_visibility, geo_content_gap]
- runFrequency: weekly
- cached: true
- importanceToRevenue: unknown
- surface: evidence
- trendViz: spark
- verdict: evidence
- longTermValue: projection panel, clearly labeled soft

## geo_competitor_visibility — Competitor AI Visibility

Brand's citation share vs each tracked competitor's citation share.

- category: geo
- source: OpenRouter (Claude Sonnet) — brand + competitor probes
- costPerCallUsd: 0.04
- costNote: Probe per competitor
- groupedWith: []
- dependsOn: []
- runFrequency: weekly
- cached: true
- importanceToRevenue: unknown
- surface: trends
- trendViz: bars
- verdict: hero
- longTermValue: alert when a competitor overtakes us on a prompt

## geo_visibility_score — GEO Visibility Score

Composite 0–100 AI visibility score blending citations, mentions, accuracy, share.

- category: geo
- source: DB analysis over other geo_* signals
- costPerCallUsd: 0
- costNote: Pure DB composite
- groupedWith: []
- dependsOn: [geo_citations, geo_mentions]
- runFrequency: daily
- cached: true
- importanceToRevenue: unknown
- surface: trends
- trendViz: ring
- verdict: hero
- longTermValue: fix accuracy first, then revenue-weight the score

## geo_alternatives — Brand Alternatives

How often competitors are suggested as alternatives to the brand by AI.

- category: geo
- source: OpenRouter (Claude Sonnet) — alternative-prompt probe
- costPerCallUsd: 0.02
- costNote: Single multi-engine prompt
- groupedWith: []
- dependsOn: []
- runFrequency: weekly
- cached: true
- importanceToRevenue: unknown
- surface: cockpit
- trendViz: before_after
- verdict: hero
- longTermValue: draft a rebuttal page when a new alternative appears

## geo_content_gap — GEO Content Gap

Topics competitors are cited for in AI answers that the brand has no content on.

- category: geo
- source: OpenRouter (Claude Sonnet) — gap-analysis prompt
- costPerCallUsd: 0.02
- costNote: Single LLM pass
- groupedWith: []
- dependsOn: []
- runFrequency: weekly
- cached: true
- importanceToRevenue: unknown
- surface: cockpit
- trendViz: before_after
- verdict: alert
- longTermValue: one-click brief for the missing page

## geo_social_signals — Social AI Signals

Estimates how social-media presence is influencing AI training-data citations.

- category: geo
- source: OpenRouter (Claude Sonnet) + social-volume signals
- costPerCallUsd: 0.02
- costNote: Single LLM pass
- groupedWith: []
- dependsOn: []
- runFrequency: weekly
- cached: true
- importanceToRevenue: unknown
- surface: evidence
- trendViz: none
- verdict: evidence
- longTermValue: social -> training-data influence; soft input

## geo_prompt_research — AI Prompt Research

Suggests prompts likely to surface (or hide) the brand in AI answers.

- category: geo
- source: OpenRouter (Claude Sonnet) — generative pass
- costPerCallUsd: 0.02
- costNote: Single LLM pass
- groupedWith: []
- dependsOn: []
- runFrequency: weekly
- cached: true
- importanceToRevenue: unknown
- surface: evidence
- trendViz: none
- verdict: evidence
- longTermValue: prompt suggestions; on-request tool

## geo_youtube_citations — YouTube AI Citations

How often YouTube videos about the brand appear in AI-generated answers.

- category: geo
- source: OpenRouter (Claude Sonnet) + YouTube Data API enrichment
- costPerCallUsd: 0.02
- costNote: LLM probe + free YouTube API
- groupedWith: []
- dependsOn: []
- runFrequency: weekly
- cached: true
- importanceToRevenue: unknown
- surface: evidence
- trendViz: delta_dots
- verdict: evidence
- longTermValue: YouTube AI citations; niche toggle

## geo_shopping_citation — Shopping Citations

AEO/GEO shopping visibility: is the brand cited/recommended on buying-intent prompts (best/top/alternatives/vs), and who wins those answers instead.

- category: geo
- source: OpenRouter (Perplexity Sonar) — name-aware buying-intent recommendation probe
- costPerCallUsd: 0.02
- costNote: buying-intent prompts × 2 Perplexity models
- groupedWith: [geo_keyword_citations, geo_citations]
- dependsOn: []
- runFrequency: weekly
- cached: true
- importanceToRevenue: unknown
- surface: evidence
- trendViz: delta_dots
- verdict: evidence
- longTermValue: buying-intent AEO; niche toggle

## geo_sentiment — AI Sentiment Score

Net sentiment of how AI answers describe the brand, rescaled to 0-100.

- category: geo
- source: Reuses geo_mentions probe responses
- costPerCallUsd: 0
- costNote: Aggregates the same-day geo_mentions snapshot
- groupedWith: [geo_mentions]
- dependsOn: [geo_mentions]
- runFrequency: daily
- cached: true
- importanceToRevenue: high
- surface: trends
- trendViz: spark

## geo_answer_position — AI Answer Position

Average ordinal rank of the brand within AI answers, where 1 means named first.

- category: geo
- source: Reuses geo_mentions probe responses
- costPerCallUsd: 0
- costNote: Aggregates the same-day geo_mentions snapshot
- groupedWith: [geo_mentions]
- dependsOn: [geo_mentions]
- runFrequency: daily
- cached: true
- importanceToRevenue: high
- surface: trends
- trendViz: spark

## geo_citation_taxonomy — Citation Source Taxonomy

Classifies AI-cited domains into owned, competitor, press, social, docs, earned and other.

- category: geo
- source: Reuses geo_citations probe (domain classification)
- costPerCallUsd: 0
- costNote: Aggregates the same-day geo_citations snapshot
- groupedWith: [geo_citations]
- dependsOn: [geo_citations]
- runFrequency: daily
- cached: true
- importanceToRevenue: medium
- surface: trends
- trendViz: bars

## geo_ai_search_volume — AI Search Volume

Estimated monthly AI-assistant query volume for the brand's tracked keywords.

- category: geo
- source: DataForSEO ai_optimization/ai_keyword_data/keywords_search_volume
- costPerCallUsd: 0.0101
- costNote: measured live — flat ~$0.01 per request plus ~$0.0001 per keyword, batched into one call
- groupedWith: []
- dependsOn: []
- runFrequency: weekly
- cached: false
- importanceToRevenue: medium
- surface: cockpit+trends
- trendViz: spark

## mentions_brand — Brand Mentions

Cross-platform brand-name mentions: Twitter, Reddit, HackerNews, YouTube (30-day rolling).

- category: mentions
- source: Twitter API v2 + Reddit API + HN Algolia + YouTube Data API
- costPerCallUsd: 0
- costNote: All free-tier APIs
- groupedWith: [mentions_keyword]
- dependsOn: [mentions_keyword]
- runFrequency: daily
- cached: true
- importanceToRevenue: unknown
- surface: feed
- trendViz: bars
- verdict: hero
- longTermValue: sentiment trend + draft replies

## mentions_keyword — Keyword Mentions

Cross-platform mentions of tracked keywords across the same surfaces as mentions_brand.

- category: mentions
- source: Twitter API v2 + Reddit API + HN Algolia + YouTube Data API
- costPerCallUsd: 0
- costNote: All free-tier APIs
- groupedWith: [mentions_brand]
- dependsOn: [mentions_brand]
- runFrequency: daily
- cached: true
- importanceToRevenue: unknown
- surface: feed+cockpit
- trendViz: bars
- verdict: hero
- longTermValue: score each hit as a reply-worthy lead

## brand_lookalike_domains — Lookalike Domains

Generates typo/homoglyph/TLD permutations of the brand domain (dnstwist algorithm) and resolves which are registered; enriches live hits with registration date (RDAP) and MX presence to flag email-capable squats.

- category: mentions
- source: Node DNS + RDAP (dnstwist permutations)
- costPerCallUsd: 0
- costNote: Free — DNS resolution + RDAP lookups
- groupedWith: []
- dependsOn: []
- runFrequency: weekly
- cached: true
- importanceToRevenue: unknown
- surface: cockpit
- trendViz: before_after
- verdict: alert
- longTermValue: takedown workflow (generate the notice)

## brand_phishing — Phishing Detection

Detects active phishing pages impersonating the brand by matching lookalike domains against the OpenPhish feed and scraping live lookalikes for cloned login forms + brand assets.

- category: mentions
- source: OpenPhish feed (free) + Firecrawl /v1/scrape
- costPerCallUsd: 0.015
- costNote: Free feed; ~1 Firecrawl credit per scanned lookalike
- groupedWith: [brand_lookalike_domains]
- dependsOn: [brand_lookalike_domains]
- runFrequency: daily
- cached: true
- importanceToRevenue: unknown
- surface: cockpit
- trendViz: before_after
- verdict: alert
- longTermValue: phishing takedown workflow

## brand_trademark_abuse — Trademark Abuse

Classifies each registered lookalike domain's content via LLM as impersonator / unauthorized reseller / parked / unrelated / legitimate to surface trademark misuse.

- category: mentions
- source: Firecrawl /v1/scrape + OpenRouter (gpt-4o-mini)
- costPerCallUsd: 0.02
- costNote: ~1 Firecrawl credit per lookalike + one classification call
- groupedWith: [brand_lookalike_domains]
- dependsOn: [brand_lookalike_domains]
- runFrequency: weekly
- cached: true
- importanceToRevenue: unknown
- surface: cockpit
- trendViz: before_after
- verdict: alert
- longTermValue: trademark takedown workflow

## social_youtube_mentions — YouTube Brand Mentions

Volume + sentiment of YouTube videos discussing the brand (30-day rolling).

- category: mentions
- source: YouTube Data API search + videos endpoint + OpenRouter (Haiku classify)
- costPerCallUsd: 0.005
- costNote: Free YouTube API + small Haiku classification
- groupedWith: []
- dependsOn: []
- runFrequency: daily
- cached: true
- importanceToRevenue: unknown
- surface: feed
- trendViz: bars
- verdict: merge:mentions_brand
- longTermValue: folds into brand mentions

## pr_news_coverage — News & Media Coverage

News articles mentioning the brand from Google News SERP (30-day rolling).

- category: mentions
- source: DataForSEO /v3/serp/google/news + OpenRouter (Sonnet sentiment)
- costPerCallUsd: 0.02
- costNote: 1 DataForSEO news task + small LLM sentiment pass
- groupedWith: []
- dependsOn: []
- runFrequency: daily
- cached: true
- importanceToRevenue: unknown
- surface: feed
- trendViz: bars
- verdict: keep
- longTermValue: alert on tier-1 press, tie to traffic spikes

## seo_backlink_changes — Backlink Gains / Losses

New high-DR backlinks, lost links, toxic links (disavow candidates), and competitor backlink gains (outreach targets).

- category: seo
- source: DataForSEO Backlinks API (summary + new_lost)
- costPerCallUsd: 0.04
- costNote: Plan-gated — requires DataForSEO Backlinks subscription; off by default
- groupedWith: []
- dependsOn: []
- runFrequency: weekly
- cached: true
- importanceToRevenue: unknown
- surface: trends
- trendViz: delta_dots
- verdict: keep
- longTermValue: plan-gated; outreach + disavow targets

## seo_cannibalization — Keyword Cannibalization

Finds keywords where two or more of the org's own URLs rank in the same Google SERP, splitting clicks and authority.

- category: seo
- source: DataForSEO Labs (ranked_keywords) + SERP API (top 20 keywords)
- costPerCallUsd: 0.02
- costNote: ~20 SERP probes per run (cached)
- groupedWith: [seo_rank]
- dependsOn: [seo_rank]
- runFrequency: weekly
- cached: true
- importanceToRevenue: unknown
- surface: cockpit
- trendViz: delta_dots
- verdict: alert
- longTermValue: which URL to consolidate + draft the redirect

## seo_indexation_health — Indexation Health

Composite 0–100 indexation-health score rolling up index coverage, noindex, canonical drift, and sitemap churn.

- category: seo
- source: DB composite over seo_index_coverage / seo_noindex_alert / seo_canonical_drift / seo_sitemap_diff
- costPerCallUsd: 0
- costNote: Pure DB composite — no external calls
- groupedWith: [seo_index_coverage, seo_noindex_alert, seo_canonical_drift, seo_sitemap_diff]
- dependsOn: [seo_index_coverage, seo_noindex_alert, seo_canonical_drift, seo_sitemap_diff]
- runFrequency: daily
- cached: true
- importanceToRevenue: unknown
- surface: trends
- trendViz: ring
- verdict: hero
- longTermValue: the composite template every module should copy

## seo_authority_score — Authority Score

Domain authority 0–100 (= Semrush Authority Score / Ahrefs Domain Rating), derived by rescaling the DataForSEO domain rank already fetched by seo_backlinks.

- category: seo
- source: DB composite over seo_backlinks (DataForSEO domain rank)
- costPerCallUsd: 0
- costNote: Pure DB composite — no external calls
- groupedWith: [seo_backlinks]
- dependsOn: [seo_backlinks]
- runFrequency: weekly
- cached: true
- importanceToRevenue: unknown

## seo_site_health — Site Health

Composite 0–100 technical-health score rolling up the technical SEO signals by severity (errors / warnings / notices), with fixed-vs-new deltas.

- category: seo
- source: DB composite over seo_error_spike / seo_canonical_drift / seo_noindex_alert / seo_cwv / seo_internal_linking / seo_indexation_health
- costPerCallUsd: 0
- costNote: Pure DB composite — no external calls
- groupedWith: [seo_error_spike, seo_canonical_drift, seo_noindex_alert, seo_cwv, seo_internal_linking, seo_indexation_health]
- dependsOn: [seo_error_spike, seo_canonical_drift, seo_noindex_alert, seo_cwv, seo_internal_linking, seo_indexation_health]
- runFrequency: daily
- cached: true
- importanceToRevenue: unknown

## seo_position_distribution — Position Distribution

Keyword counts across the 1–3 / 4–10 / 11–20 / 21–50 / 51–100 ranking buckets, derived from the ranked keywords seo_keyword_changes already fetches.

- category: seo
- source: DB composite over seo_keyword_changes (DataForSEO ranked keywords)
- costPerCallUsd: 0
- costNote: Pure DB composite — no external calls
- groupedWith: [seo_keyword_changes]
- dependsOn: [seo_keyword_changes]
- runFrequency: daily
- cached: true
- importanceToRevenue: unknown

## seo_traffic_value — Traffic Value

Estimated dollar value of organic traffic: organic CTR-by-position × search volume × CPC, i.e. what the traffic would cost via paid search.

- category: seo
- source: DB composite over seo_keyword_changes (DataForSEO ranked keywords)
- costPerCallUsd: 0
- costNote: Pure DB composite — no external calls
- groupedWith: [seo_keyword_changes]
- dependsOn: [seo_keyword_changes]
- runFrequency: daily
- cached: true
- importanceToRevenue: unknown

## seo_serp_volatility — SERP Volatility

Day-over-day flux across tracked keyword positions (= Semrush Sensor). High shared movement flags a likely Google algorithm update vs a site-specific issue.

- category: seo
- source: DB composite over consecutive seo_keyword_changes snapshots
- costPerCallUsd: 0
- costNote: Pure DB composite — no external calls
- groupedWith: [seo_keyword_changes]
- dependsOn: [seo_keyword_changes]
- runFrequency: daily
- cached: true
- importanceToRevenue: unknown
