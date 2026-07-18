---
name: Tecknode signal engine + execution APIs (Phase 2)
overview: "Make the account-scoped backend actually produce data: port RunAgents' 64-capability signal engine (Task 5) and the secure execution APIs — cron tick, manual refresh, run-status polling (Task 6) — onto the user-scoped foundation from Phase 1. After this phase the system can: add entity → trigger a capability → real connectors run → snapshots + signals land in the DB → run status is pollable."
todos:
  - id: p2-catalog-prune
    content: "Task 5a: prune capability catalog to exactly 64 (32 SEO / 25 GEO / 7 Mentions-Brand); trim CAPABILITY_KEYS + CAPABILITY_META in intel.model.ts, regenerate migration, add signal-scope invariant test"
    status: pending
  - id: p2-shared-clients
    content: "Task 5b: port shared provider clients + intel helpers used by retained modules (DataForSEO, OpenRouter, Firecrawl, Google PSI, DNS/HTTP, fetch-cache, output-schemas, scoring, provenance full, keys, mentions/** + seo/** helpers), env-gated"
    status: pending
  - id: p2-modules
    content: "Task 5c: port retained SEO + GEO + Mentions/Brand modules (~90 files) via parallel subagents, organizationId -> userId, drop excluded imports"
    status: pending
  - id: p2-runner-scheduler
    content: "Task 5d: port dispatcher, capability-order, runner, scheduler, run-context; rewrite ownership to userId; wire idempotency keys, usage records, snapshot writes; signals:gen + signals:check pass"
    status: pending
  - id: p2-cron-auth
    content: "Task 6a: add src/lib/cron-auth.ts (constant-time Bearer CRON_SECRET) and route-security tests (bad cron secret, unauth refresh, foreign entity/run)"
    status: pending
  - id: p2-routes
    content: "Task 6b: port /api/intel tick + refresh + runs/[id] routes, user-scoped + ownership-checked, Next 16 awaited params; route tests + type-check + build pass"
    status: pending
isProject: false
---

# Tecknode Cursor - Phase 2: Signal Engine + Execution APIs (Migration Tasks 5-6)

## Context

- **Builds on Phase 1** (Tasks 1-4, complete): bun bootstrap, Better Auth (user-scoped), user-scoped Drizzle schema + migration, repositories, and `accountAction` server actions. All ownership is `user.id`; there is no `organizationId`.
- **Governing spec:** `origin/docs/tecknode-prd-migration` branch — [migration plan](../../docs/superpowers/plans/2026-07-18-runagents-to-tecknode-migration.md) Tasks 5-6, and marketing-intelligence [PRD.md](../../docs/PRD.md).
- **Source:** RunAgents app at `../runagents` (pnpm, Next 16). Port selectively; never copy wholesale. Convert `pnpm`/`pnpm dlx` invocations to `bun`/`bunx`.
- **Goal of this phase:** turn the static foundation into a *runnable* system. After Phase 2, an authenticated user can trigger one of the 64 capabilities (manually or via cron) and see real `signal_snapshots` + `signals` rows appear, then poll the `connector_runs` status.
- **Out of this phase:** dashboard/tracking UI wiring (Task 7), integrations + delivery channels (Task 8), digests/briefs (Task 9), Ask Intel chat (Task 10), dependency cleanup (Task 11), E2E cutover (Task 12).

## Core constraints (from the migration plan)

- Catalog must be **exactly 64 capabilities: 32 SEO, 25 GEO, 7 Mentions/Brand**. No dependency on an excluded key.
- Advertising integrations are allowed as *data sources* later, but **paid-ad signal capabilities are NOT migrated**. Also excluded: `comp_*`, `ads_*`, `uptime_*`, `personal_*`, `page_*` (audit product surfaces), `dev_*`, `platform_*`, `email_*`, `audit_*`, `landing_*` — anything outside the 64.
- Every route/scheduled job derives `userId` from a verified session or a trusted cron payload — never client input.
- Next.js 16: await `headers()`, `cookies()`, route `params`, `searchParams`.
- Generated SQL migrations only (`bun run db:generate`); `db:push` only for disposable local DBs.

## Important discrepancy to resolve first

Phase 1 ported `src/server/db/models/intel.model.ts` with the **full** RunAgents `CAPABILITY_KEYS`/`CAPABILITY_META` (150+ keys spanning ads/comp/uptime/personal/page/etc.), not the pruned 64. The enum-typed columns (`capability_key`) therefore currently accept out-of-scope keys. **Task 5a must prune these down to 64** and regenerate the migration so the DB enum and the engine agree. This is the first and most delicate step because it touches an already-applied schema.

---

## Task 5 - Prune and port the 64-capability signal engine

### 5a. Prune the capability catalog to 64 (do this first)

- Edit `src/server/db/models/intel.model.ts`: reduce `CAPABILITY_KEYS` and `CAPABILITY_META` to exactly the retained 64:
  - **Keep** every `seo_*` (target 32) and every `geo_*` (target 25) that exists in the retained source scope.
  - **Keep** `mentions_brand`, `mentions_keyword`, `brand_lookalike_domains`, `brand_phishing`, `brand_trademark_abuse`, `social_youtube_mentions`, `pr_news_coverage` (7).
  - **Delete** all `ads_*`, `comp_*`, `uptime_*`, `personal_*`, `page_*`, `dev_*`, `platform_*`, `email_*`, `audit_*`, `landing_*` keys and their `CAPABILITY_META` entries.
  - Reconcile `SIGNAL_CATEGORIES` and `categoryForCapability` to the surviving prefixes (`seo`, `geo`, `mentions`). Update `FIRST_RUN_CAPABILITIES` to a retained subset.
- Copy/adapt `runagents/src/lib/intel/signal-catalog.md` + `signal-catalog.ts`, pruned to the 64. Copy `runagents/scripts/gen-signal-catalog.mjs` → `scripts/` (bun-compatible) and add `signals:gen` + `signals:check` scripts to `package.json`.
- Generate `src/lib/intel/signal-catalog.generated.ts` via `bun run signals:gen`.
- **Regenerate the DB migration:** `bun run db:generate --name=prune_capabilities` then re-apply to a clean local DB (`docker compose up -d` + `bun run db:migrate`). Confirm the `capability_key` enum now lists 64 values.
- **Test** `src/lib/intel/signal-scope.test.ts`:

```ts
expect(CAPABILITY_KEYS).toHaveLength(64);
expect(countByCategory("seo")).toBe(32);
expect(countByCategory("geo")).toBe(25);
expect(countByCategory("mentions")).toBe(7);
expect(excludedCapabilityKeys()).toEqual([]);
expect(missingDispatcherCases()).toEqual([]);
expect(missingDependencies()).toEqual([]);
```

### 5b. Port shared provider clients + intel helpers

Port only what retained modules import, env-gated so the app still boots without provider keys:

- Provider clients: DataForSEO, OpenRouter, Firecrawl, Google PSI, direct HTTP/DNS helpers.
- Intel infrastructure: `fetch-cache.ts`, `output-schemas.ts`, `connector-output.ts`, `connector-errors.ts`, `keys.ts`, `score-threshold.ts`, `recommendations.ts` (only if retained modules use it), and the **full** `provenance.ts` (Phase 1 trimmed it — restore `buildSnapshotProvenance` + its `capability-order` dependency now that `capability-order.ts` lands here).
- Helpers under `src/lib/mentions/**` (aggregate, boolean-query, classify, cluster, reach, search, resolve-handle, clients, store, types) and `src/lib/seo/**` (fetch-page-head, indexnow, probe-url-status, url-compare, seo-indexing).
- Add the retained provider env vars to `src/env/server.ts` if any are still missing (most are already present as optional: `OPENROUTER_API_KEY`, `DATAFORSEO_LOGIN/PASSWORD`, `FIRECRAWL_API_KEY`, `GOOGLE_PSI_API_KEY`).

### 5c. Port retained capability modules (~90 files, parallelizable)

- Copy/adapt every `runagents/src/lib/intel/modules/seo-*.ts` and `geo-*.ts`, plus the 7 mention/brand/pr/social modules and their top-level implementation files (e.g. `ai-mentions.ts`, `ai-citations.ts`, `authority-score.ts`, `site-health.ts`, `indexation-health.ts`, `cannibalization.ts`, `citation-*.ts`, `co-citations.ts`, `content-*.ts`, `visibility-score.ts`, etc.).
- Transform rule per file: `organizationId` → `userId`; drop imports of excluded modules/capabilities; keep provider/scoring/diff logic intact.
- **Do not port** modules for excluded capabilities (ads/comp/uptime/personal/page/dev/platform/email/audit/landing).
- Bring over the retained module tests.

### 5d. Port dispatcher, ordering, runner, scheduler

- `capability-order.ts` (+ test): dependency edges among retained keys. Preserve: SEO rank producer deps; SEO indexing/site-health composites; GEO citation producer/derivative ordering; GEO mention sentiment/position ordering; brand lookalike → phishing/trademark ordering. Replace the circular mentions dependency with **one internal cached scan** shared by `mentions_brand` + `mentions_keyword`.
- `dispatcher.ts` (+ test): map each of the 64 keys to its module runner; assert no missing cases.
- `run-context.ts`, `runner.ts`, `scheduler.ts`: rewrite ownership — run context, idempotency keys, `api_usage_events`, logs, and snapshot writes all keyed by `userId`. Use the Phase 1 repos (`connectorRunRepo`, `signalSnapshotRepo`, `signalRepo`, `apiUsageRepo`, `intelTickRepo`, `trackedEntityRepo`, `userIntelSettingsRepo`).
- Verify:

```bash
bun run signals:check
bun run test src/lib/intel
bun run type-check
```

Expected: 64 capability contracts pass; no excluded module is imported anywhere.

---

## Task 6 - Cron, manual refresh, and run-status APIs

### 6a. Cron auth + security tests

- Create `src/lib/cron-auth.ts`: require `Authorization: Bearer <CRON_SECRET>`, constant-time compare, reject query-string secrets. `CRON_SECRET` is already in `src/env/server.ts` (optional; required in prod).
- Test `test/api/intel-routes.test.ts` covering: invalid/missing cron secret → 401; unauthenticated refresh → 401; refresh of a **foreign** entity → 403/404 with no leak; polling a **foreign** run → 403/404.

### 6b. Routes

- `src/app/api/intel/tick/route.ts`: cron-authenticated global tick. Enumerates active users with tracked entities and applies per-user cadence (`CAPABILITY_META[k].cadenceDays`), safety limits, backoff, concurrency. Writes an `intel_ticks` heartbeat row at start, updates stats at finish.
- `src/app/api/intel/refresh/route.ts`: resolves the session user via `getAccountContextOrJson()`, validates entity ownership (`trackedEntityRepo.findByIdForUser`), then enqueues one of the 64 allowed capabilities. Reject unknown/excluded keys.
- `src/app/api/intel/runs/[id]/route.ts`: await `params`; return the run only if `connectorRun.userId === ctx.userId`, else 404.
- (Defer `/api/intel/digest` to Task 9; defer `firehose`/`purge`/`brief`/`chat` — out of scope or later.)
- Verify:

```bash
bun run test test/api/intel-routes.test.ts
bun run type-check
bun run build
```

---

## Subagent strategy

- **5a (catalog prune)** and **5d (runner/scheduler)** are delicate and sequential — do them directly, not via subagents.
- **5b (shared clients/helpers)** and **5c (~90 modules)** are the mechanical fan-out. After 5a + the dispatcher signature land, dispatch multiple Sonnet-class subagents to port modules in independent batches (e.g. seo-batch-1, seo-batch-2, geo-batch-1, geo-batch-2, mentions-batch), each given: exact source paths, target paths, the `organizationId → userId` rule, and the "drop excluded imports" rule. Reserve Opus for 5a/5d and Task 6 route security.
- Task 6 routes are small; do them directly.

## Prerequisites / env

- A live Postgres `DATABASE_URL` (Docker `docker compose up -d`) to re-run migrations after the catalog prune and to exercise runner/route integration tests.
- To exercise *real* connector output (optional this phase): `OPENROUTER_API_KEY`, `DATAFORSEO_LOGIN`/`DATAFORSEO_PASSWORD`, `FIRECRAWL_API_KEY`, `GOOGLE_PSI_API_KEY`. Without them, modules should no-op with a `dataIssue` (no signal, no spend) — tests must not require live keys.
- `CRON_SECRET` (min 32 chars) for tick-route tests.

## Risks / watch-outs

- **Enum migration:** pruning `capability_key` values changes an already-applied Postgres enum. On a clean dev DB this is a fresh migration; document that Phase 2 assumes a clean DB (the plan mandates no production data migration), or add an explicit enum-alter migration if the local DB must be preserved.
- **Dependency cycles:** the mentions circular dependency must become a single shared cached scan, or the tiered drain will deadlock/re-fetch.
- **Scope creep via imports:** a retained module importing an excluded helper silently drags excluded scope back in. The `signal-scope.test.ts` invariant (`excludedCapabilityKeys()` / `missingDependencies()`) is the guardrail — write it first.
- **Count reconciliation:** confirm the retained source actually yields 32 SEO + 25 GEO. If RunAgents' current retained set differs, reconcile against `signal-catalog.md` before locking the invariant test numbers.

## Verification for this phase

`bun run signals:check`, `bun run test`, `bun run type-check`, `bun run lint`, `bun run build` all pass; the 64-capability invariant holds; a manual `refresh` for an owned entity produces a `connector_runs` row + `signal_snapshots`/`signals`; cron `tick` rejects a bad secret and processes owned users; foreign-entity/foreign-run access returns not-found/forbidden with no metadata leak.
