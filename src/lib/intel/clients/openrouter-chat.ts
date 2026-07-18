import {
  dollarsToMicroUsd,
  recordApiUsage,
} from "@/lib/observability/api-usage";

export const OPENROUTER_CHAT_URL =
  "https://openrouter.ai/api/v1/chat/completions";

/**
 * The metered chokepoint for every OpenRouter chat completion (issue #364).
 *
 * Until this existed, ~20 modules each called `fetch(OPENROUTER_CHAT_URL, …)`
 * directly and none of them read `usage` off the response, so LLM spend was
 * invisible to `api_usage_events`. That matters beyond reporting: the per-org
 * monthly spend cap in `scheduler.ts` decides whether to enqueue by summing
 * that table (`isOverBudget` → `apiUsageRepo.spendForOrgSince`). With the GEO /
 * LLM probes — the largest single line of COGS — missing from the sum, the cap
 * was metering a fraction of real spend and would not trip when it should.
 *
 * Drop-in for `fetch`: returns a real `Response`, so callers keep using
 * `res.ok` / `res.status` / `res.json()` exactly as before. The body is read
 * once here to pull `usage` out, then handed back in a fresh `Response` — a
 * `Response` body can only be consumed once, so it cannot simply be forwarded.
 *
 * Org / entity / run / capability are NOT passed in: `recordApiUsage` reads
 * them from the AsyncLocalStorage context the runner already establishes
 * (`withApiUsageContext`), the same way the DataForSEO and Firecrawl clients do.
 */
export async function openrouterFetch(
  operation: string,
  init: RequestInit,
): Promise<Response> {
  const startedAt = Date.now();

  let res: Response;
  try {
    res = await fetch(OPENROUTER_CHAT_URL, withUsageAccounting(init));
  } catch (err) {
    // Network-level failure: no tokens burned, but record the attempt so a
    // provider outage is visible in the usage table rather than a silent hole.
    await recordApiUsage({
      provider: "openrouter",
      operation,
      unitType: "token",
      units: 0,
      costMicroUsd: BigInt(0),
      costSource: "unknown",
      status: "error",
      errorCode: err instanceof Error ? err.name : "fetch_failed",
      durationMs: Date.now() - startedAt,
    });
    throw err;
  }

  const body = await res.text();
  const usage = parseUsage(body);

  await recordApiUsage({
    provider: "openrouter",
    operation,
    unitType: "token",
    units: usage.totalTokens,
    // A failed call still bills for whatever it generated, so cost is recorded
    // regardless of status — only `units`/`cost` being genuinely absent makes
    // this zero.
    costMicroUsd:
      usage.costUsd != null ? dollarsToMicroUsd(usage.costUsd) : BigInt(0),
    costSource: usage.costUsd != null ? "body" : "unknown",
    status: res.ok ? "success" : "error",
    httpStatus: res.status,
    durationMs: Date.now() - startedAt,
  });

  // Fresh Response — the original's body is already consumed. Headers are
  // deliberately dropped: replaying `content-encoding`/`content-length` from a
  // decoded body would misdescribe it, and no caller reads them.
  const responseInit = { status: res.status, statusText: res.statusText };
  // A null-body status (204/304/…) must be constructed with a null body or the
  // Response ctor throws — an upstream proxy could return one even though
  // OpenRouter itself returns 200/4xx/5xx.
  return NULL_BODY_STATUSES.has(res.status)
    ? new Response(null, responseInit)
    : new Response(body, responseInit);
}

/** HTTP statuses the Fetch spec forbids from carrying a body. */
const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);

/**
 * Ask OpenRouter to include real billed cost in the response body, so spend is
 * read from the provider rather than estimated from a local price table that
 * drifts every time a model is repriced.
 */
function withUsageAccounting(init: RequestInit): RequestInit {
  if (typeof init.body !== "string") return init;
  try {
    const parsed = JSON.parse(init.body) as Record<string, unknown>;
    // Merge, don't clobber: preserve any usage options a caller already set.
    const existingUsage =
      typeof parsed.usage === "object" && parsed.usage !== null
        ? (parsed.usage as Record<string, unknown>)
        : {};
    return {
      ...init,
      body: JSON.stringify({
        ...parsed,
        usage: { ...existingUsage, include: true },
      }),
    };
  } catch {
    // Not JSON we understand — send it untouched rather than break the call.
    // Usage is then absent and the event records tokens/cost as unknown.
    return init;
  }
}

interface ParsedUsage {
  totalTokens: number;
  /** Billed cost in USD when OpenRouter reports it; null when it doesn't. */
  costUsd: number | null;
}

function parseUsage(body: string): ParsedUsage {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return { totalTokens: 0, costUsd: null };
  }

  const usage = (json as { usage?: Record<string, unknown> } | null)?.usage;
  if (!usage) return { totalTokens: 0, costUsd: null };

  const n = (v: unknown): number =>
    typeof v === "number" && Number.isFinite(v) ? v : 0;

  const totalTokens =
    n(usage.total_tokens) ||
    n(usage.prompt_tokens) + n(usage.completion_tokens);

  const cost = usage.cost;
  return {
    totalTokens,
    costUsd: typeof cost === "number" && Number.isFinite(cost) ? cost : null,
  };
}
