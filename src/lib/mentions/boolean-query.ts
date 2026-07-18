/**
 * #27 — advanced boolean query model (AND / OR / NOT).
 *
 * The standard "advanced search" shape (Twitter/Brand24/Awario): match ALL of
 * these AND ANY of these AND NONE of these. Simpler than a nested expression
 * tree and covers the real use case.
 */
export type BooleanQuery = {
  all: string[]; // every term must appear (AND)
  any: string[]; // at least one must appear (OR group)
  none: string[]; // none may appear (NOT)
};

export type BooleanStyle = "full" | "simple";

export function isEmptyBoolean(bq: BooleanQuery | undefined | null): boolean {
  if (!bq) return true;
  return bq.all.length === 0 && bq.any.length === 0 && bq.none.length === 0;
}

const clean = (t: string) => t.trim().replace(/[\\"]/g, "");
const quote = (t: string) => (t.includes(" ") ? `"${t}"` : t);

/**
 * Renders a BooleanQuery to a platform query fragment.
 * - "full"   → operator-rich (X, GitHub, Reddit):  termA termB (x OR y) -z
 * - "simple" → no-operator engines (Bluesky/etc): best-effort, all+any OR'd,
 *              NOT dropped (the platform can't express it).
 */
export function renderBooleanQuery(
  bq: BooleanQuery,
  style: BooleanStyle = "full",
): string {
  const all = bq.all.map(clean).filter(Boolean).map(quote);
  const any = bq.any.map(clean).filter(Boolean).map(quote);
  const none = bq.none.map(clean).filter(Boolean).map(quote);

  if (style === "simple") {
    // No boolean support: union of all+any, drop NOT (can't represent).
    return [...all, ...any].join(" OR ");
  }

  const parts: string[] = [];
  if (all.length) parts.push(all.join(" "));
  if (any.length) parts.push(any.length > 1 ? `(${any.join(" OR ")})` : any[0]);
  for (const n of none) parts.push(`-${n}`);
  return parts.join(" ");
}
