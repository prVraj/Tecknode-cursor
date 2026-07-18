# RunAgents to Tecknode Cursor Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Tecknode Cursor by selectively migrating the proven RunAgents marketing-intelligence implementation while retaining only the features defined in `PRD.md`.

**Architecture:** Create a fresh Next.js 16 App Router application and port reusable RunAgents modules in dependency order. Replace organization-scoped ownership with direct authenticated-user ownership, prune the signal catalog to SEO, GEO, and Mentions/Brand Protection, and derive integrations from one approved-provider allowlist. Do not copy the source repository wholesale.

**Tech Stack:** Next.js 16, React 19, TypeScript, PostgreSQL/Neon, Drizzle ORM, Better Auth, React Query, Tailwind CSS, Shadcn/Base UI, OpenRouter, DataForSEO, Firecrawl, Composio, Resend, Upstash Redis, Vitest, and Biome.

## Global Constraints

- The target product is account-scoped: persisted product data belongs directly to `user.id`.
- The signal catalog must contain exactly 64 capabilities: 32 SEO, 25 GEO, and 7 Mentions/Brand Protection.
- Allowed data integrations are GA4, GSC, PostHog, Plausible, Clarity, Ahrefs, Semrush, Google Ads, Reddit Ads, YouTube, Instagram, TikTok, LinkedIn, Reddit, and Facebook.
- Allowed delivery integrations are Slack, Telegram, and Discord.
- Organizations, workspaces, onboarding, billing, MCP, admin, public marketing, Firehose, recommendations, audit product surfaces, and legacy sandboxes must not be migrated.
- Advertising integrations are allowed as connected data sources; paid-ad signal capabilities are not.
- Every server action, repository query, route handler, scheduled job, and AI tool must derive `userId` from a verified server-side session or trusted cron payload.
- Use generated SQL migrations in the target. `drizzle-kit push` is allowed only for disposable local databases.
- Next.js 16 request-time APIs such as `headers()`, `cookies()`, route `params`, and `searchParams` must be awaited.
- No production data migration is included. The first deployment uses a clean target database.

---

## Target file structure

```text
Tecknode-cursor/
├── PRD.md
├── package.json
├── pnpm-lock.yaml
├── next.config.ts
├── drizzle.config.ts
├── vitest.config.ts
├── .env.example
├── migrations/
├── scripts/
│   └── gen-signal-catalog.mjs
└── src/
    ├── app/
    │   ├── (auth)/
    │   ├── (app)/dashboard/
    │   │   ├── chat/
    │   │   ├── digest/
    │   │   ├── integrations/
    │   │   ├── settings/
    │   │   └── tracking/
    │   └── api/
    │       ├── auth/
    │       ├── integrations/
    │       └── intel/
    ├── components/
    ├── emails/
    ├── env/
    ├── hooks/
    ├── lib/
    │   ├── analytics/
    │   ├── integrations/
    │   ├── intel/
    │   ├── mentions/
    │   └── seo/
    └── server/
        ├── actions/
        ├── db/
        │   ├── models/
        │   └── repos/
        └── integrations/
```

## Migration method

For each source file:

1. Copy only when all imports belong to the retained scope.
2. Adapt when the file contains `organizationId`, billing checks, MCP registration, admin behavior, or excluded capability imports.
3. Rebuild when the source file combines retained and excluded UI or provider registries.
4. Delete any temporary copied file that still imports excluded modules.

Use this ownership replacement consistently:

```ts
export type AccountContext = {
  userId: string;
  log: ScopedLogger;
};

export type AccountOwned = {
  userId: string;
};
```

Never accept ownership from client input:

```ts
const session = await auth.api.getSession({ headers: await headers() });
if (!session?.user.emailVerified) throw new Error("UNAUTHENTICATED");
const userId = session.user.id;
```

---

### Task 1: Bootstrap the target application

**Files:**
- Create: `package.json`
- Create: `pnpm-lock.yaml`
- Create: `next.config.ts`
- Create: `tsconfig.json`
- Create: `next-env.d.ts`
- Create: `postcss.config.mjs`
- Create: `drizzle.config.ts`
- Create: `vitest.config.ts`
- Create: `biome.json`
- Create: `.env.example`
- Create: `src/app/layout.tsx`
- Create: `src/app/globals.css`
- Create: `src/app/page.tsx`
- Create: `src/env/client.ts`
- Create: `src/env/server.ts`
- Copy selectively: `runagents/src/components/ui/**` → `src/components/ui/**`
- Copy selectively: `runagents/src/lib/utils.ts` → `src/lib/utils.ts`

**Interfaces:**
- Produces: a buildable Next.js application with `@/*` mapped to `src/*`.
- Produces: validated server/client environment modules used by all later tasks.

- [ ] **Step 1: Create the package manifest from the retained dependency graph**

Start from `runagents/package.json`, remove Dodo, MCP, PDF, Remotion, drag-and-drop, and sandbox-only packages, and keep only packages imported by retained files.

Required scripts:

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "biome check",
    "format": "biome format --write",
    "type-check": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "db:studio": "drizzle-kit studio",
    "auth:generate": "tsx scripts/generate-auth-schema.ts",
    "signals:gen": "node scripts/gen-signal-catalog.mjs",
    "signals:check": "node scripts/gen-signal-catalog.mjs --check"
  }
}
```

- [ ] **Step 2: Configure Next.js 16 and TypeScript**

Use App Router and async request APIs. Create `next-env.d.ts` with generated route typing:

```ts
/// <reference types="next" />
/// <reference types="next/image-types/global" />
import "./.next/types/routes.d.ts";
```

- [ ] **Step 3: Configure Drizzle migrations**

```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema.ts",
  out: "./migrations",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
});
```

- [ ] **Step 4: Add the minimal environment contract**

Include only:

```env
DATABASE_URL=
BETTER_AUTH_SECRET=
NEXT_PUBLIC_SERVER_URL=http://localhost:3000
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
RESEND_API_KEY=
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
TURNSTILE_SECRET_KEY=
NEXT_PUBLIC_TURNSTILE_SITE_KEY=
SECRET_ENCRYPTION_KEY=
CRON_SECRET=
OPENROUTER_API_KEY=
DATAFORSEO_LOGIN=
DATAFORSEO_PASSWORD=
FIRECRAWL_API_KEY=
GOOGLE_PSI_API_KEY=
COMPOSIO_API_KEY=
```

Add provider-specific delivery credentials only when Task 8 ports those routes.

- [ ] **Step 5: Install and verify the empty application**

Run:

```bash
pnpm install
pnpm type-check
pnpm lint
pnpm test
pnpm build
```

Expected: all commands exit successfully; tests may report zero test files only at this stage.

- [ ] **Step 6: Commit the foundation**

```bash
git add package.json pnpm-lock.yaml next.config.ts tsconfig.json next-env.d.ts postcss.config.mjs drizzle.config.ts vitest.config.ts biome.json .env.example src
git commit -m "chore: initialize Tecknode Cursor application"
```

---

### Task 2: Implement authentication and account ownership

**Files:**
- Create: `src/lib/auth.ts`
- Create: `src/lib/auth-client.ts`
- Create: `src/app/api/auth/[...better-auth]/route.ts`
- Copy/adapt: `runagents/src/app/(auth)/**` → `src/app/(auth)/**`
- Copy/adapt: `runagents/src/emails/verification-email.tsx` → `src/emails/verification-email.tsx`
- Copy/adapt: `runagents/src/emails/password-reset-email.tsx` → `src/emails/password-reset-email.tsx`
- Copy/adapt: `runagents/src/emails/welcome-email.tsx` → `src/emails/welcome-email.tsx`
- Create: `src/server/action-utils.ts`
- Create: `src/server/db/models/auth.model.ts`
- Create: `src/server/db/models/account-deletion.model.ts`
- Create: `src/server/actions/account.actions.ts`
- Test: `src/server/action-utils.test.ts`
- Test: `src/server/actions/account.actions.test.ts`

**Interfaces:**
- Produces: `auth`, `authClient`, `AccountContext`, and `accountAction`.
- Produces: authenticated `userId` for all later repositories and actions.

- [ ] **Step 1: Write failing authorization tests**

Cover:

```ts
it("rejects a request without a session", async () => {
  await expect(resolveAccountContext(null)).rejects.toThrow("UNAUTHENTICATED");
});

it("uses only the verified session user id", async () => {
  const context = await resolveAccountContext(verifiedSession("user-a"));
  expect(context.userId).toBe("user-a");
});
```

- [ ] **Step 2: Configure Better Auth**

Use `drizzleAdapter(db, { provider: "pg", schema })`, email/password, verification email, Google OAuth, rate limiting, optional Upstash secondary storage, Turnstile, email hygiene, and `nextCookies()`.

Do not register:

```ts
admin();
organization();
mcp();
dodopayments();
```

- [ ] **Step 3: Add the Next.js auth route**

```ts
import { auth } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";

export const { GET, POST } = toNextJsHandler(auth);
```

- [ ] **Step 4: Generate and review the auth schema**

Run:

```bash
pnpm auth:generate
```

Expected tables: `user`, `session`, `account`, and `verification`. No organization, member, invitation, subscription, OAuth application, MCP key, role, ban, or impersonation tables.

- [ ] **Step 5: Implement `accountAction`**

Every action must resolve a verified server session and expose:

```ts
export type AccountContext = {
  userId: string;
  log: ScopedLogger;
};
```

- [ ] **Step 6: Port account export and delayed deletion**

Deletion must invalidate all sessions, disconnect Composio accounts, clear delivery secrets, and schedule the user cascade after 30 days. Remove all MCP-key and organization references.

- [ ] **Step 7: Run auth tests**

```bash
pnpm test src/server/action-utils.test.ts src/server/actions/account.actions.test.ts
pnpm type-check
```

Expected: tests pass with no organization or billing imports.

- [ ] **Step 8: Commit authentication**

```bash
git add src/lib/auth.ts src/lib/auth-client.ts src/app/api/auth src/app/\(auth\) src/emails src/server
git commit -m "feat: add account-scoped authentication"
```

---

### Task 3: Create the user-scoped database model

**Files:**
- Create: `src/server/db/index.ts`
- Create: `src/server/db/schema.ts`
- Create: `src/server/db/models/intel.model.ts`
- Create: `src/server/db/models/mention.model.ts`
- Create: `src/server/db/models/entity-state.model.ts`
- Create: `src/server/db/models/digest.model.ts`
- Create: `src/server/db/models/intel-chat.model.ts`
- Create: `src/server/db/models/integration.model.ts`
- Create: `src/server/db/models/delivery.model.ts`
- Create: `src/server/db/models/observability.model.ts`
- Test: `test/db/user-isolation.test.ts`

**Interfaces:**
- Produces: user-owned Drizzle models consumed by repositories.
- Preserves: entity/capability/day uniqueness and connector-run idempotency.

- [ ] **Step 1: Write the cross-user isolation test**

Create two users that track the same domain and assert each user sees only their own entities, signals, runs, digests, integrations, and conversations.

- [ ] **Step 2: Port retained domain tables**

Create:

- `tracked_entities`
- `connector_runs`
- `intel_ticks`
- `signal_snapshots`
- `signals`
- `signal_feedback`
- `entity_state`
- `mention_records`
- `digest_runs`
- `intel_conversations`
- `intel_messages`
- `user_intel_settings`
- `user_integration_connections`
- `user_delivery_configs`
- `user_brief_configs`
- `api_usage_events`
- `account_deletion_requests`

Replace every source `organizationId` with:

```ts
userId: text("user_id")
  .notNull()
  .references(() => user.id, { onDelete: "cascade" });
```

- [ ] **Step 3: Add user-scoped indexes**

At minimum:

```ts
index("signals_user_created_idx").on(table.userId, table.createdAt);
index("snapshots_user_category_date_idx").on(
  table.userId,
  table.category,
  table.capturedDate,
);
```

- [ ] **Step 4: Generate and apply the initial migration**

```bash
pnpm db:generate --name=init
pnpm db:migrate
```

Expected: migration creates only target-scope tables.

- [ ] **Step 5: Run isolation and schema tests**

```bash
pnpm test test/db/user-isolation.test.ts
```

Expected: both users may track the same domain without reading each other's records.

- [ ] **Step 6: Commit the schema**

```bash
git add src/server/db migrations test/db
git commit -m "feat: add user-scoped intelligence schema"
```

---

### Task 4: Port repositories and server actions

**Files:**
- Copy/adapt: `runagents/src/server/db/repos/tracked-entity.repo.ts`
- Copy/adapt: `runagents/src/server/db/repos/signal.repo.ts`
- Copy/adapt: `runagents/src/server/db/repos/signal-snapshot.repo.ts`
- Copy/adapt: `runagents/src/server/db/repos/signal-feedback.repo.ts`
- Copy/adapt: `runagents/src/server/db/repos/connector-run.repo.ts`
- Copy/adapt: `runagents/src/server/db/repos/intel-tick.repo.ts`
- Copy/adapt: `runagents/src/server/db/repos/mention-record.repo.ts`
- Copy/adapt: `runagents/src/server/db/repos/entity-state.repo.ts`
- Copy/adapt: `runagents/src/server/db/repos/digest.repo.ts`
- Copy/adapt: `runagents/src/server/db/repos/intel-conversation.repo.ts`
- Copy/adapt: `runagents/src/server/db/repos/api-usage.repo.ts`
- Copy/adapt: `runagents/src/server/actions/intel.actions.ts`
- Copy/adapt: `runagents/src/server/actions/intel-digest.actions.ts`
- Copy/adapt: `runagents/src/server/actions/intel-chat.actions.ts`
- Test: `test/server/ownership-actions.test.ts`

**Interfaces:**
- Produces: `listByUser`, `findForUser`, and user-scoped CRUD methods.
- Consumes: `AccountContext` and user-scoped Drizzle tables.

- [ ] **Step 1: Write failing ownership tests**

Test forged entity, signal, run, digest, and conversation IDs belonging to a second user. Every action must return not found or forbidden without revealing foreign metadata.

- [ ] **Step 2: Rename organization repository methods**

Examples:

```ts
listByOrg(organizationId) -> listByUser(userId)
findLatestForOrg(organizationId) -> findLatestForUser(userId)
listHistoryForOrg(organizationId, ...) -> listHistoryForUser(userId, ...)
```

- [ ] **Step 3: Rewrite actions around `accountAction`**

Actions must never accept `userId`. Entity and record IDs are inputs; ownership is checked using `ctx.userId`.

- [ ] **Step 4: Remove excluded action imports**

Delete onboarding, billing, organization, invitation, admin, audit, IndexNow, Firehose, sandbox, and MCP references.

- [ ] **Step 5: Run action tests**

```bash
pnpm test test/server/ownership-actions.test.ts
pnpm type-check
```

- [ ] **Step 6: Commit repositories and actions**

```bash
git add src/server/db/repos src/server/actions test/server
git commit -m "feat: add user-scoped intelligence actions"
```

---

### Task 5: Prune and port the 64-capability signal engine

**Files:**
- Copy/adapt: `runagents/src/lib/intel/signal-catalog.md`
- Copy/adapt: `runagents/src/lib/intel/signal-catalog.ts`
- Generate: `src/lib/intel/signal-catalog.generated.ts`
- Copy/adapt: `runagents/scripts/gen-signal-catalog.mjs`
- Copy/adapt: `runagents/src/lib/intel/dispatcher.ts`
- Copy/adapt: `runagents/src/lib/intel/runner.ts`
- Copy/adapt: `runagents/src/lib/intel/scheduler.ts`
- Copy/adapt: `runagents/src/lib/intel/capability-order.ts`
- Copy/adapt: retained shared files under `runagents/src/lib/intel/`
- Copy/adapt: all `runagents/src/lib/intel/modules/seo-*.ts`
- Copy/adapt: all `runagents/src/lib/intel/modules/geo-*.ts`
- Copy/adapt: seven retained mention/brand modules
- Copy/adapt: required helpers under `runagents/src/lib/mentions/**` and `runagents/src/lib/seo/**`
- Test: `src/lib/intel/signal-scope.test.ts`
- Test: retained source module tests

**Interfaces:**
- Produces: `CAPABILITY_KEYS`, `CAPABILITY_META`, dispatcher, scheduler, runner, and validated outputs.
- Capability contract: exactly 64 keys with no dependency on an excluded key.

- [ ] **Step 1: Write the catalog invariant test**

```ts
expect(CAPABILITY_KEYS).toHaveLength(64);
expect(countByCategory("seo")).toBe(32);
expect(countByCategory("geo")).toBe(25);
expect(countByCategory("mentions")).toBe(7);
expect(excludedCapabilityKeys()).toEqual([]);
expect(missingDispatcherCases()).toEqual([]);
expect(missingDependencies()).toEqual([]);
```

- [ ] **Step 2: Prune the catalog**

Keep:

- Every `seo_*` capability.
- Every `geo_*` capability.
- `mentions_brand`
- `mentions_keyword`
- `brand_lookalike_domains`
- `brand_phishing`
- `brand_trademark_abuse`
- `social_youtube_mentions`
- `pr_news_coverage`

Delete all other catalog entries and proposed-signal documentation from the runtime catalog.

- [ ] **Step 3: Generate the typed catalog**

```bash
pnpm signals:gen
pnpm signals:check
```

Expected: generated catalog matches the 64-key source.

- [ ] **Step 4: Port retained modules and shared clients**

Preserve DataForSEO, OpenRouter, Firecrawl, Google PSI, direct HTTP/DNS helpers, scoring, provenance, output validation, caching, and diff logic only where imported by retained modules.

- [ ] **Step 5: Resolve dependency edges**

Preserve:

- SEO rank producer dependencies.
- SEO indexing and site-health composites.
- GEO citation producer/derivative ordering.
- GEO mention sentiment/position ordering.
- Brand lookalike → phishing/trademark ordering.

Replace the circular mentions dependency with one internal cached scan shared by `mentions_brand` and `mentions_keyword`.

- [ ] **Step 6: Rewrite runner and scheduler ownership**

Change run context, idempotency keys, usage records, logs, and snapshot writes from `organizationId` to `userId`.

- [ ] **Step 7: Run signal tests**

```bash
pnpm signals:check
pnpm test src/lib/intel
pnpm type-check
```

Expected: 64 capability contracts pass; no excluded module is imported.

- [ ] **Step 8: Commit the signal engine**

```bash
git add scripts src/lib/intel src/lib/mentions src/lib/seo
git commit -m "feat: migrate scoped SEO GEO and mentions signals"
```

---

### Task 6: Add cron, manual refresh, and run-status APIs

**Files:**
- Copy/adapt: `runagents/src/app/api/intel/tick/route.ts`
- Copy/adapt: `runagents/src/app/api/intel/refresh/route.ts`
- Copy/adapt: `runagents/src/app/api/intel/runs/[id]/route.ts`
- Copy/adapt: `runagents/src/app/api/intel/digest/route.ts`
- Create: `src/lib/cron-auth.ts`
- Test: `test/api/intel-routes.test.ts`

**Interfaces:**
- Produces: scheduled global tick, authenticated manual refresh, owned run polling, and scheduled digest routes.

- [ ] **Step 1: Write route-security tests**

Cover invalid cron secret, unauthenticated refresh, foreign entity refresh, and foreign run polling.

- [ ] **Step 2: Implement constant-time cron authentication**

Require `Authorization: Bearer <CRON_SECRET>` and reject query-string secrets.

- [ ] **Step 3: Adapt tick scheduling**

The global tick enumerates active users with tracked entities and applies per-user cadence, safety limits, backoff, and concurrency.

- [ ] **Step 4: Adapt manual refresh**

The route resolves the session user and validates entity ownership before enqueueing one of the 64 allowed capabilities.

- [ ] **Step 5: Run route tests**

```bash
pnpm test test/api/intel-routes.test.ts
```

- [ ] **Step 6: Commit API routes**

```bash
git add src/app/api/intel src/lib/cron-auth.ts test/api
git commit -m "feat: add secure intelligence execution routes"
```

---

### Task 7: Build dashboard and tracking interfaces

**Files:**
- Copy/adapt: `runagents/src/app/(app)/dashboard/page.tsx`
- Rebuild: `src/app/(app)/dashboard/tracking/page.tsx`
- Move/adapt: retained files from `runagents/src/app/(app)/dashboard/competitors/_components/**`
- Copy/adapt: `runagents/src/app/(app)/dashboard/_components/recent-signals-feed.tsx`
- Create: `src/app/(app)/dashboard/layout.tsx`
- Rebuild: `src/components/sidebar.tsx`
- Test: `test/e2e/tracking.test.ts`

**Interfaces:**
- Consumes: entity, signal, snapshot, run, and feedback actions.
- Produces: first-run setup, dashboard feed, entity management, signal drill-down, and manual execution.

- [ ] **Step 1: Write E2E tests for the primary flow**

Test authenticated user → add primary brand → add competitor → edit keywords/location → open signal grid → filter SEO/GEO/Mentions → run capability → inspect evidence.

- [ ] **Step 2: Build session-only dashboard layout**

Await `headers()`, require an authenticated verified session, and remove onboarding, organization switching, billing banners, impersonation, and admin behavior.

- [ ] **Step 3: Adapt the dashboard**

Show competitor count, signals this week, active capability count, recent feed, search, and severity filters.

- [ ] **Step 4: Rebuild competitors as Tracking**

Move `/dashboard/competitors` to `/dashboard/tracking`. Keep primary/competitor CRUD, social discovery, keyword/location editing, summary metrics, signal category tabs, data issues, saved payload, and Run Now.

- [ ] **Step 5: Restrict category tabs**

Render only:

```ts
const CATEGORIES = ["all", "seo", "geo", "mentions"] as const;
```

- [ ] **Step 6: Rebuild sidebar navigation**

Include Dashboard, Tracking, Daily Brief, Integrations, Ask Intel, and Settings. Remove organization switcher, upgrade card, billing state, admin, MCP, and sandbox links.

- [ ] **Step 7: Run UI tests**

```bash
pnpm test test/e2e/tracking.test.ts
pnpm build
```

- [ ] **Step 8: Commit dashboard UI**

```bash
git add src/app/\(app\)/dashboard src/components/sidebar.tsx test/e2e
git commit -m "feat: add dashboard and tracking experience"
```

---

### Task 8: Port the approved integrations and delivery channels

**Files:**
- Create: `src/lib/integrations/provider-catalog.ts`
- Copy/adapt: `runagents/src/lib/composio.ts`
- Rebuild: `src/lib/integrations/oauth-providers.ts`
- Copy/adapt: retained fetchers under `runagents/src/lib/analytics/**`
- Rebuild: `src/server/actions/integration.actions.ts`
- Rebuild: `src/app/(app)/dashboard/integrations/page.tsx`
- Create: `src/app/(app)/dashboard/integrations/_components/provider-card.tsx`
- Copy/adapt: Slack, Telegram, and Discord routes under `runagents/src/app/api/integrations/**`
- Copy/adapt: `runagents/src/server/integrations/broadcast.ts`
- Test: `src/lib/integrations/provider-catalog.test.ts`
- Test: `test/api/integration-ownership.test.ts`

**Interfaces:**
- Produces: one provider allowlist used by schema, actions, UI, health checks, and analytics dispatch.
- Produces: account-owned Slack, Telegram, and Discord delivery configuration.

- [ ] **Step 1: Write provider-scope tests**

```ts
expect(DATA_PROVIDERS).toHaveLength(15);
expect(DELIVERY_PROVIDERS).toEqual(["slack", "telegram", "discord"]);
expect(disallowedProvidersPresent()).toEqual([]);
```

- [ ] **Step 2: Define the single data-provider catalog**

```ts
export const DATA_PROVIDERS = [
  "ga4", "gsc", "posthog", "plausible", "clarity",
  "ahrefs", "semrush",
  "googleAds", "redditAds",
  "youtube", "instagram", "tiktok", "linkedin", "reddit", "facebook",
] as const;
```

- [ ] **Step 3: Port only required fetchers**

Retain analytics/search, SEO, advertising, and social registry dispatch. Delete payment, commerce, product analytics, email, CRM, and support fetchers.

- [ ] **Step 4: Adapt Composio identity**

Use Better Auth `user.id` as the Composio external user ID. Store connected-account IDs by `userId`.

- [ ] **Step 5: Implement provider lifecycle**

Support connect, target selection, confirmation polling, reconnect, disconnect, and revoked-account health reconciliation.

- [ ] **Step 6: Port delivery channels**

Adapt Slack OAuth, Telegram pairing/webhook, and Discord bot/channel selection to `userId`. Encrypt stored secrets with `SECRET_ENCRYPTION_KEY`.

- [ ] **Step 7: Run integration tests**

```bash
pnpm test src/lib/integrations test/api/integration-ownership.test.ts
```

- [ ] **Step 8: Commit integrations**

```bash
git add src/lib/composio.ts src/lib/integrations src/lib/analytics src/server/actions/integration.actions.ts src/server/integrations src/app/api/integrations src/app/\(app\)/dashboard/integrations test/api
git commit -m "feat: add approved data and delivery integrations"
```

---

### Task 9: Port digests and scheduled briefs

**Files:**
- Copy/adapt: `runagents/src/lib/intel/digest/**`
- Copy/adapt: `runagents/src/lib/intel/daily-brief.ts`
- Copy/adapt: `runagents/src/lib/intel/format-brief.ts`
- Copy/adapt: `runagents/src/lib/intel/send-daily-brief.ts`
- Copy/adapt: `runagents/src/emails/daily-brief-email.tsx`
- Copy/adapt: `runagents/src/app/(app)/dashboard/digest/**`
- Rebuild: `src/app/(app)/dashboard/settings/_components/briefs-view.tsx`
- Create: `src/server/actions/brief.actions.ts`
- Test: `src/lib/intel/digest/digest-scope.test.ts`
- Test: `src/lib/intel/brief-schedule.test.ts`

**Interfaces:**
- Produces: manual digest generation, digest history, daily/weekly scheduling, email delivery, and channel broadcast.

- [ ] **Step 1: Write digest-scope tests**

Assert that digest context includes only the authenticated user's SEO, GEO, and Mentions signals.

- [ ] **Step 2: Port digest generation**

Replace organization ownership with user ownership and filter all capability input through the 64-key allowlist.

- [ ] **Step 3: Implement timezone-aware scheduling**

Persist IANA timezone, local send hour, cadence, and weekday. Resolve UTC at execution time so daylight-saving transitions do not drift.

- [ ] **Step 4: Adapt delivery**

Send email to the authenticated user's email and broadcast the same brief to each connected delivery channel. One failed channel must not prevent other deliveries.

- [ ] **Step 5: Run brief tests**

```bash
pnpm test src/lib/intel/digest src/lib/intel/brief-schedule.test.ts
```

- [ ] **Step 6: Commit briefs**

```bash
git add src/lib/intel/digest src/lib/intel/daily-brief.ts src/lib/intel/format-brief.ts src/lib/intel/send-daily-brief.ts src/emails src/app/\(app\)/dashboard/digest src/app/\(app\)/dashboard/settings src/server/actions/brief.actions.ts
git commit -m "feat: add intelligence digests and scheduled briefs"
```

---

### Task 10: Port conversational intelligence without MCP

**Files:**
- Copy/adapt: `runagents/src/app/api/intel/chat/route.ts`
- Copy/adapt: `runagents/src/lib/intel/chat/**`
- Rebuild: `src/lib/intel/tools/index.ts`
- Copy/adapt: retained prompts under `runagents/src/lib/intel/prompts/**`
- Copy/adapt: dashboard chat components
- Copy/adapt: `runagents/src/app/(app)/dashboard/chat/**`
- Test: `test/api/chat-ownership.test.ts`
- Test: `test/e2e/ask-intel.test.ts`

**Interfaces:**
- Produces: user-owned conversation history, grounded signal citations, signal search/detail, comparisons, snapshots, digests, analytics status, and “What broke?”.
- Explicitly does not produce an MCP endpoint, OAuth application, API key, tool registration, or MCP prompt.

- [ ] **Step 1: Write chat authorization tests**

Test unauthenticated access, foreign conversation IDs, foreign signal IDs, and tool calls attempting to retrieve another user's records.

- [ ] **Step 2: Rebuild the internal AI tool catalog**

Keep only:

- `search_signals`
- `get_signal_detail`
- `compare_entities`
- `get_snapshot`
- `get_snapshot_history`
- `get_digest`
- `list_digests`
- `get_analytics_status`
- `get_analytics_data`
- `get_integration_status`
- `whats_broken`
- `submit_feedback`

Every tool closes over a trusted `userId`.

- [ ] **Step 3: Port the streaming chat route**

Require verified authentication, enforce rate and token limits, rebuild history from trusted stored messages, run bounded tool loops, persist usage, and return source attachments.

- [ ] **Step 4: Port chat UI**

Enable the full Ask Intel page in production. Keep conversation history, new-chat behavior, grounded citations, source links, context attachments, and signal feedback.

- [ ] **Step 5: Prove MCP is absent**

Run:

```bash
rg -n -i "modelcontextprotocol|mcp-handler|/api/mcp|mcp_api|registerMcp" .
```

Expected: no matches outside migration documentation and explicit out-of-scope text in `PRD.md`.

- [ ] **Step 6: Run chat tests**

```bash
pnpm test test/api/chat-ownership.test.ts test/e2e/ask-intel.test.ts
```

- [ ] **Step 7: Commit conversational intelligence**

```bash
git add src/app/api/intel/chat src/app/\(app\)/dashboard/chat src/lib/intel/chat src/lib/intel/tools src/lib/intel/prompts test
git commit -m "feat: add grounded conversational intelligence"
```

---

### Task 11: Remove excluded code and dependencies

**Files:**
- Modify: `package.json`
- Modify: `.env.example`
- Modify: `src/server/db/schema.ts`
- Modify: navigation and route files as required
- Create: `scripts/check-scope.mjs`
- Test: `test/scope/excluded-features.test.ts`

**Interfaces:**
- Produces: a machine-enforced scope boundary for CI.

- [ ] **Step 1: Write the scope check**

Fail when source code, schema, routes, or dependencies contain excluded runtime features:

```ts
const excluded = [
  "organization",
  "member",
  "invitation",
  "billing",
  "subscription",
  "dodopayments",
  "mcp",
  "admin",
  "onboarding",
  "sandbox",
  "firehose",
  "audit_snapshot",
  "comp_",
  "ads_",
  "page_",
  "email_",
  "uptime_",
  "personal_",
];
```

Allow explicit text matches only in `PRD.md`, migration documentation, and the checker itself.

- [ ] **Step 2: Remove dead dependencies**

Run an import/dependency audit and delete packages no retained source imports.

- [ ] **Step 3: Remove dead environment variables**

Ensure `.env.example` and both env schemas contain only runtime-required variables.

- [ ] **Step 4: Verify no excluded routes exist**

No target routes may exist for admin, onboarding, billing, MCP, audit, sandbox, Firehose, or public marketing.

- [ ] **Step 5: Run scope verification**

```bash
node scripts/check-scope.mjs
pnpm signals:check
pnpm type-check
pnpm lint
```

- [ ] **Step 6: Commit scope enforcement**

```bash
git add package.json pnpm-lock.yaml .env.example src scripts/check-scope.mjs test/scope
git commit -m "chore: enforce Tecknode Cursor product scope"
```

---

### Task 12: End-to-end verification and cutover

**Files:**
- Create: `test/e2e/product-journey.test.ts`
- Create: `docs/operations/deployment.md`
- Create: `docs/operations/cron.md`
- Create: `docs/operations/provider-setup.md`

**Interfaces:**
- Produces: release evidence and operator instructions.

- [ ] **Step 1: Implement the complete product journey**

Automate:

1. Sign up and verify email.
2. Add a primary brand and competitor.
3. Add keywords and location.
4. Run one SEO, GEO, and Mentions capability.
5. Verify dashboard signals and evidence.
6. Generate a digest.
7. Ask Intel a question and verify citations.
8. Connect a mocked analytics provider.
9. Configure a brief.
10. Export account data and request deletion.

- [ ] **Step 2: Run the full verification suite**

```bash
pnpm signals:check
node scripts/check-scope.mjs
pnpm type-check
pnpm lint
pnpm test
pnpm build
```

Expected: all commands exit successfully.

- [ ] **Step 3: Run a clean-database smoke test**

Use isolated provider credentials and one test account. Confirm scheduler writes only user-owned rows and all 64 capabilities either succeed or return explicit `dataIssues`.

- [ ] **Step 4: Verify catalog and provider counts**

Required assertions:

```text
Capabilities: 64 total
SEO: 32
GEO: 25
Mentions and Brand Protection: 7
Data providers: 15
Delivery providers: 3
MCP routes/tools/keys: 0
```

- [ ] **Step 5: Document deployment**

Document migrations, environment variables, Better Auth callback URLs, Composio auth configs, Slack/Telegram/Discord setup, cron authorization, rollback, and secret rotation.

- [ ] **Step 6: Commit release verification**

```bash
git add test/e2e/product-journey.test.ts docs/operations
git commit -m "test: verify complete Tecknode Cursor migration"
```

## Final acceptance criteria

- A user can authenticate, manage their account, and never access another user's data.
- A user can track a primary brand and competitors without an onboarding wizard.
- The dashboard exposes only SEO, GEO, and Mentions/Brand Protection signals.
- Exactly 64 capability modules are cataloged, dispatchable, test-covered, and dependency-valid.
- Approved analytics, SEO, advertising, social, and delivery integrations can connect and disconnect.
- Digests and briefs use only in-scope signal data.
- Ask Intel is available in production and returns grounded, user-owned evidence.
- No organization, billing, MCP, admin, public marketing, experimental, or legacy-sandbox runtime remains.
- Database migrations apply cleanly to an empty PostgreSQL database.
- Type checking, linting, unit tests, integration tests, E2E tests, scope checks, and production build all pass.

## Execution order

Execute Tasks 1–12 sequentially. Tasks 5 and 8 may use parallel subagents only after Tasks 1–4 are merged because both depend on the final user-scoped schema and action boundary. Do not enable production cron until Task 12 smoke verification passes.
