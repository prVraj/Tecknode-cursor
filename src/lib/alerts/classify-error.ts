export type AlertSeverity = "critical" | "warning";

/**
 * Values are dedup keys in `alert_dedup` — renaming any of them breaks
 * cooldown continuity for in-flight incidents.
 */
export type AlertReason =
  | "insufficient_credits"
  | "auth_invalid"
  | "rate_limited"
  | "upstream_error"
  | "request_invalid"
  | "timeout"
  | "unknown_error";

export type Provider =
  | "dataforseo"
  | "openrouter"
  | "firecrawl"
  | "apify"
  | "resend"
  | "composio"
  | "mxtoolbox"
  | "github"
  | "gdelt"
  | "twitter"
  | "youtube"
  | "telegram"
  | "slack"
  | "discord"
  | "unknown";

const KNOWN_PROVIDERS: ReadonlySet<Provider> = new Set([
  "dataforseo",
  "openrouter",
  "firecrawl",
  "apify",
  "resend",
  "composio",
  "mxtoolbox",
  "github",
  "gdelt",
  "twitter",
  "youtube",
  "telegram",
  "slack",
  "discord",
  "unknown",
]);

const PAID_PROVIDERS: ReadonlySet<Provider> = new Set([
  "dataforseo",
  "openrouter",
  "firecrawl",
  "apify",
  "youtube",
  "twitter",
  "mxtoolbox",
]);

export interface ErrorClassification {
  provider: Provider;
  severity: AlertSeverity;
  reason: AlertReason;
  httpStatus?: number;
}

/**
 * Per-provider because each one phrases credit exhaustion differently and a
 * shared list (just "quota") would false-positive on unrelated errors.
 *
 * Some entries cover non-credit billing failures (account suspended,
 * subscription lapsed) — same actionable signal as "out of credits" for the
 * founder, so they share the `insufficient_credits` reason rather than
 * fragmenting the dedup key.
 *
 * YouTube and Twitter quota errors land on the wrong HTTP status if read
 * blind (YouTube 403, Twitter 429 — would otherwise resolve to auth_invalid
 * / rate_limited), so the body-marker check has to beat the generic mapping.
 */
const CREDIT_MARKERS: Partial<Record<Provider, readonly string[]>> = {
  dataforseo: [
    "insufficient", // 40210 "Insufficient Funds…"
    "not enough money",
    "cost limit has been exceeded", // 40203 cost-cap hit
    "payment required", // 40200 generic payment
    "paused access", // 40201 account suspended (precaution)
    "visit plans and subscriptions", // 40204 subscription lapsed
  ],
  openrouter: [
    "insufficient_credits",
    "insufficient credits",
    "requires more credits",
  ],
  firecrawl: ["quota", "credit", "upgrade your plan"],
  apify: ["usage limit", "quota", "monthly-usage-hard-limit"],
  youtube: ["quotaexceeded", "dailylimitexceeded", "dailylimitexceededunreg"],
  twitter: ["usagecapexceeded"],
};

/**
 * Provider comes from a `readonly provider` field on the error itself (set by
 * each client's custom error class — see DataForSeoApiError, FirecrawlApiError,
 * etc.). Falls back to "unknown" when an error isn't tagged, in which case we
 * don't page anyone but still log the classifier output.
 */
export function classifyError(err: unknown): ErrorClassification | null {
  if (err == null) return null;
  const provider = detectProvider(err);
  const message = err instanceof Error ? err.message : String(err);
  const httpStatus = extractHttpStatus(err, message);
  const lower = message.toLowerCase();

  // Body-text matches beat HTTP status — DataForSEO returns 200 + an error
  // body for credit issues, so the status code alone would miss it.
  const markers = CREDIT_MARKERS[provider];
  if (markers?.some((m) => lower.includes(m))) {
    return {
      provider,
      severity: "critical",
      reason: "insufficient_credits",
      httpStatus,
    };
  }
  if (provider === "github" && httpStatus === 422) {
    // GitHub search returns 422 on empty/malformed queries — our caller bug.
    return null;
  }

  if (httpStatus === 401 || httpStatus === 403) {
    return {
      provider,
      severity: "critical",
      reason: "auth_invalid",
      httpStatus,
    };
  }
  if (httpStatus === 402) {
    return {
      provider,
      severity: "critical",
      reason: "insufficient_credits",
      httpStatus,
    };
  }
  if (httpStatus === 429) {
    return {
      provider,
      severity: "warning",
      reason: "rate_limited",
      httpStatus,
    };
  }
  if (httpStatus && httpStatus >= 500 && httpStatus < 600) {
    return {
      provider,
      severity: "warning",
      reason: "upstream_error",
      httpStatus,
    };
  }
  if (httpStatus === 400 || httpStatus === 422) {
    return null;
  }

  if (
    err instanceof Error &&
    (err.name === "AbortError" || lower.includes("aborted"))
  ) {
    return { provider, severity: "warning", reason: "timeout" };
  }

  // Unknown shape — only page on paid providers; free-tier flakiness is noise.
  if (PAID_PROVIDERS.has(provider)) {
    return {
      provider,
      severity: "warning",
      reason: "unknown_error",
      httpStatus,
    };
  }

  return null;
}

function detectProvider(err: unknown): Provider {
  if (err && typeof err === "object" && "provider" in err) {
    const p = (err as { provider: unknown }).provider;
    if (typeof p === "string" && KNOWN_PROVIDERS.has(p as Provider)) {
      return p as Provider;
    }
  }
  return "unknown";
}

/**
 * Structured properties (`err.status`, `err.response.status`, …) beat regex
 * over the message string, which false-positives on incidental 3-digit
 * numbers like "limit of 500 exceeded" or "took 502ms".
 */
function extractHttpStatus(err: unknown, message: string): number | undefined {
  if (err && typeof err === "object") {
    const obj = err as Record<string, unknown>;
    const response = (obj.response ?? {}) as Record<string, unknown>;
    const candidates = [
      obj.status,
      obj.statusCode,
      response.status,
      response.statusCode,
    ];
    for (const c of candidates) {
      if (typeof c === "number" && c >= 100 && c < 600) return c;
    }
  }
  const match = message.match(/\b([1-5]\d{2})\b/);
  if (!match) return undefined;
  const parsed = Number.parseInt(match[1] ?? "", 10);
  if (parsed >= 100 && parsed < 600) return parsed;
  return undefined;
}
