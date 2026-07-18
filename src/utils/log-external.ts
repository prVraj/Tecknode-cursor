import logger from "@/utils/logger";

const externalLogger = logger.withContext({ module: "external" });

/**
 * Well-known third-party sources, for consistent log filtering. The type
 * also accepts any string (e.g. "ga4", "stripe") so callers are never blocked,
 * while editors still autocomplete the common ones.
 */
export type ExternalSource =
  | "openrouter"
  | "firecrawl"
  | "dataforseo"
  | "serper"
  | "apify"
  | "composio"
  | "resend"
  | "youtube"
  | "twitter"
  | "bluesky"
  | "news"
  | "mxtoolbox"
  | "github"
  | "statuspage"
  | "dns"
  | "tls"
  | "fetch"
  | "hackernews"
  | "stackoverflow"
  | (string & {});

/**
 * Log a swallowed third-party / external failure WITHOUT changing control flow.
 * Call this immediately before the existing fallback `return`.
 *
 * @param source     which external dependency failed
 * @param operation  dotted operation id, e.g. "social-signals.fetchLlmInsights"
 * @param err        the caught error (or a synthetic Error for non-OK responses)
 * @param meta       extra structured fields (status, domain, url, entityId, ...)
 */
export function logExternalFailure(
  source: ExternalSource,
  operation: string,
  err: unknown,
  meta?: Record<string, unknown>,
): void {
  // Structured keys come AFTER ...meta so a call site can never accidentally
  // clobber the canonical external.*/error.* fields log queries rely on.
  externalLogger.warn(`[${source}] ${operation} failed`, {
    ...meta,
    "external.source": source,
    "external.operation": operation,
    "error.message": err instanceof Error ? err.message : String(err),
    ...(err instanceof Error ? { "error.type": err.name } : {}),
    ...(err instanceof Error && err.stack
      ? { "error.stack": err.stack.slice(0, 500) }
      : {}),
  });
}
