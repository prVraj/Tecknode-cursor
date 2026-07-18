# Tecknode Cursor Draft Product Requirements Document

## Product overview

Tecknode Cursor is a marketing-intelligence platform that monitors a brand and its competitors across traditional search, AI search, and online mentions. It turns collected data into prioritized signals, searchable evidence, scheduled briefs, and grounded AI answers.

The product should help users answer:

- How visible is the brand in traditional and AI-powered search?
- What changed across rankings, citations, mentions, and brand risk?
- Which changes require immediate action?
- How does the brand compare with tracked competitors?
- What happened recently, and what should the user do next?

## Authentication and account

- Email/password signup and login.
- Google OAuth login.
- Email verification and automatic post-verification login.
- Forgot/reset password flows.
- Cloudflare Turnstile bot protection.
- Rate limiting and disposable-email protection.
- Sign out, JSON account-data export, and scheduled account deletion with a 30-day grace period.
- Account-deletion requests immediately revoke connected OAuth tokens.

## Dashboard

- Competitors tracked, weekly signal count, and active capability count.
- Recent intelligence feed.
- Signal search and severity filtering.
- Severity levels: critical, high, medium, and low.

## Brand and competitor tracking

- Track a primary brand and competitor domains.
- Add, edit, or remove tracked entities.
- Store brand name, keywords, location, and social profiles.
- Automatic competitor social-profile discovery.
- Entity summary cards showing SEO rank, AI visibility, and mentions.
- Per-entity signal history, raw evidence, connector status, errors, and data-quality issues.
- Manual **Run Now** for individual capabilities.

## Intelligence collection

- Scheduled collection with capability-specific daily, weekly, biweekly, or monthly cadence.
- Time-series snapshots for trends and comparisons.
- Change detection that emits actionable alerts.
- Evidence including source URLs, before/after hashes, diff snippets, and confidence.
- Cost tracking, safety limits, retries, dependency ordering, and run logs.
- Signal feedback with thumbs-up/down and reasons such as inaccurate, irrelevant, or not actionable.

## Signal categories

This PRD focuses on **64 capabilities across three product categories**: SEO, GEO, and Mentions and Brand Protection.

### SEO — 32 capabilities

- Keyword rankings, keyword gap, intent, gains/losses, and position distribution.
- Organic share of voice, traffic estimates, traffic value, and SERP volatility.
- SERP features and answer-box ownership.
- Local and international rankings.
- Backlinks, authority score, and backlink gains/losses.
- Core Web Vitals and site-health score.
- Content score, freshness, decay, CTR anomalies, and cannibalization.
- Sitemap changes, index coverage, accidental noindex, canonical drift, and indexation health.
- 404/redirect monitoring and internal-linking gaps.

### GEO / AI search visibility — 25 capabilities

- Citations and brand mentions across AI answers.
- Per-engine and per-keyword citation breakdowns.
- Citation sources, taxonomy, authority, velocity, and causality.
- Co-citations and perceived competitor set.
- AI sentiment and answer position.
- Geographic mention distribution.
- Competitor AI visibility and composite GEO visibility score.
- AI accuracy audits.
- AI traffic estimates and lift projections.
- Brand alternatives and GEO content gaps.
- Prompt research, AI search volume, shopping citations, YouTube citations, and social AI influence.

### Mentions and brand protection — 7 capabilities

- Brand and keyword mentions across Twitter/X, Reddit, Hacker News, and YouTube.
- YouTube-specific mention and sentiment monitoring.
- News and media coverage.
- Lookalike/typosquatted domains.
- Phishing detection.
- Trademark-abuse classification.

## Briefs and digests

- AI-generated digest from recent signals.
- Searchable digest history.
- Headline, categorized findings, and suggested actions.
- Manual **Generate now** for a 24-hour window.
- Scheduled daily or weekly delivery.
- Configurable weekday and local delivery time.
- Email delivery to the authenticated user.
- Optional broadcast to Slack, Telegram, and Discord.
- Delivery status, last-run time, and next-run time.

## Connections and integrations

### Analytics and search

- Google Analytics 4.
- Google Search Console.
- PostHog.
- Plausible.
- Microsoft Clarity.

### SEO

- Ahrefs.
- Semrush.

### Advertising

- Google Ads.
- Reddit Ads.

### Social

- YouTube.
- Instagram.
- TikTok.
- LinkedIn.
- Reddit.
- Facebook.

### Delivery channels

- Slack.
- Telegram.
- Discord.

Connections use managed OAuth where supported. Users must be able to connect, reconnect, disconnect, and select the relevant property, site, project, or account.

## Conversational intelligence

- Dashboard AI widget for asking questions about signals.
- Persistent Ask Intel conversations with grounded answers and signal citations.
- Search signals by entity, capability, severity, time range, and text.
- Open signal details with supporting evidence and source links.
- Compare tracked entities across a selected capability and time window.
- Retrieve snapshot history, digests, analytics, and integration status.
- Summarize high-severity issues through a **What broke?** workflow.
- Preserve conversation history per authenticated user.

## Explicitly out of scope

- Organizations, workspaces, member roles, invitations, and workspace switching.
- Onboarding wizard.
- Billing, subscriptions, checkout, and payment-provider integrations.
- Public marketing pages, free-audit funnel, and administrative dashboards.
- Experimental Firehose and standalone recommendation surfaces.
- Signal categories other than SEO, GEO, and Mentions and Brand Protection.
- Legacy sandbox and Mission Control surfaces.