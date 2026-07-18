import type { NormalizedMention, PlatformClient } from "../types";

const API = "https://en.wikipedia.org/w/api.php";

type SearchResult = {
  pageid: number;
  title: string;
  snippet?: string;
  timestamp?: string;
};

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * #17 — articles mentioning the brand (MediaWiki search). No auth/key.
 * `srsort=last_edit_desc` surfaces recently-edited articles first, so a fresh
 * edit to a page that mentions the brand shows up at the top (the "edited"
 * half of the trigger). `timestamp` = the article's last edit.
 */
export const wikipediaClient: PlatformClient = {
  platform: "wikipedia",
  async search({ brandName, limit }) {
    const url = new URL(API);
    url.searchParams.set("action", "query");
    url.searchParams.set("list", "search");
    url.searchParams.set("srsearch", brandName);
    url.searchParams.set("srlimit", String(Math.min(limit, 50)));
    url.searchParams.set("srprop", "snippet|timestamp");
    url.searchParams.set("srsort", "last_edit_desc");
    url.searchParams.set("format", "json");
    url.searchParams.set("origin", "*");

    const res = await fetch(url, {
      headers: { "User-Agent": "runagents-mentions/1.0" },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Wikipedia ${res.status}: ${res.statusText}`);
    const body = (await res.json()) as {
      query?: { search?: SearchResult[] };
    };

    return (body.query?.search ?? []).map((r): NormalizedMention => {
      const snippet = r.snippet ? stripHtml(r.snippet) : "";
      return {
        platform: "wikipedia",
        id: String(r.pageid),
        text: snippet ? `${r.title} — ${snippet}` : r.title,
        url: `https://en.wikipedia.org/?curid=${r.pageid}`,
        author: { name: null, handle: null },
        createdAt: r.timestamp ?? new Date().toISOString(),
        engagement: {},
        context: "wikipedia article",
      };
    });
  },
};
