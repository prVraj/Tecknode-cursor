import {
  extractDataForSeoSerpData,
  fetchDataForSeoSerp,
} from "@/lib/dataforseo";
import logger from "@/utils/logger";

/**
 * Resolve a domain → its X/Twitter handle via a domain-anchored web search.
 * Shared by the test page and the mentions runner. Returns a bare handle
 * (no `@`, no URL) or null. Never throws — a failed lookup just yields null.
 */

// Reserved X paths that are not user profiles.
const HANDLE_BLOCKLIST = new Set([
  "intent",
  "share",
  "home",
  "search",
  "i",
  "hashtag",
  "explore",
  "settings",
  "login",
  "signup",
  "compose",
  "messages",
  "notifications",
]);

/**
 * Pull a bare handle out of an X/Twitter profile URL, or null.
 * Delegates to normalizeHandle, which already strips the domain, `@`, query
 * params, subpaths, and validates the handle + reserved-path blocklist — so a
 * URL like `x.com/handle?s=20` or `x.com/handle/status/1` still resolves.
 */
export function handleFromUrl(url: string): string | null {
  return normalizeHandle(url);
}

/** Normalize a user-supplied value (URL / @handle / bare) → bare handle or null. */
export function normalizeHandle(raw: string | null | undefined): string | null {
  const v = raw?.trim();
  if (!v) return null;
  const stripped = v
    .replace(/^@/, "")
    .replace(/^https?:\/\/(?:www\.)?(?:x|twitter)\.com\//i, "")
    .split(/[/?#]/)[0]
    ?.toLowerCase();
  if (!stripped || HANDLE_BLOCKLIST.has(stripped)) return null;
  return /^[a-z0-9_]{1,15}$/.test(stripped) ? stripped : null;
}

export async function resolveTwitterHandle(
  domain: string,
): Promise<string | null> {
  // Domain-anchored query catches the right handle even for generic brand names.
  const query = `"${domain}" site:x.com OR site:twitter.com`;
  try {
    const raw = await fetchDataForSeoSerp({ keyword: query });
    const { organic } = extractDataForSeoSerpData(raw);
    for (const r of organic) {
      const h = handleFromUrl(r.link);
      if (h) return h;
    }
    return null;
  } catch (err) {
    logger.warn("[mentions] handle resolution failed", {
      domain,
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
