/**
 * Normalize a URL for "is this the same page?" comparisons used by the SEO
 * indexing signals. Collapses the distinctions that don't change page identity:
 * protocol, a leading `www.`, trailing slash, and case of host. Query strings
 * and fragments are dropped. Returns the raw input if it can't be parsed.
 */
export function normalizeUrlForCompare(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    const host = u.host.toLowerCase().replace(/^www\./, "");
    const path = u.pathname.replace(/\/$/, "") || "/";
    return `${host}${path}`;
  } catch {
    return rawUrl.trim().toLowerCase();
  }
}
