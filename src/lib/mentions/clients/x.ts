import { env } from "@/env/server";
import {
  type BooleanQuery,
  isEmptyBoolean,
  renderBooleanQuery,
} from "../boolean-query";
import type { NormalizedMention, PlatformClient } from "../types";

const SEARCH_URL = "https://api.x.com/2/tweets/search/recent";

function brandAnchor(
  brandName: string,
  handle: string | null,
  domain: string,
): string {
  const parts: string[] = [];
  if (handle) parts.push(`@${handle}`);
  parts.push(`"${brandName}"`);
  if (domain) parts.push(domain);
  return parts.length > 1 ? `(${parts.join(" OR ")})` : (parts[0] ?? "");
}

function buildQuery(
  brandName: string,
  handle: string | null,
  domain: string,
  keywords: string[],
  booleanQuery?: BooleanQuery,
): string {
  const anchor = brandAnchor(brandName, handle, domain);
  const tail = "-is:retweet -is:reply lang:en";

  // #27: boolean filter, when present, is AND'd onto the brand anchor.
  if (!isEmptyBoolean(booleanQuery)) {
    return `${anchor} ${renderBooleanQuery(booleanQuery as BooleanQuery, "full")} ${tail}`;
  }

  // Otherwise keywords OR into the anchor (item #5).
  const parts = [anchor];
  for (const k of keywords) {
    const t = k.trim();
    if (t) parts.push(t.includes(" ") ? `"${t}"` : t);
  }
  const merged = parts.length > 1 ? `(${parts.join(" OR ")})` : parts[0];
  return `${merged} ${tail}`;
}

type XApiResponse = {
  data?: Array<{
    id: string;
    text: string;
    author_id: string;
    created_at: string;
    public_metrics?: {
      like_count?: number;
      retweet_count?: number;
      reply_count?: number;
      impression_count?: number;
    };
  }>;
  includes?: {
    users?: Array<{
      id: string;
      username: string;
      name: string;
      public_metrics?: { followers_count?: number };
    }>;
  };
  errors?: Array<{ detail?: string; message?: string }>;
  detail?: string;
};

export const xClient: PlatformClient = {
  platform: "x",
  async search({ brandName, handle, domain, keywords, booleanQuery, limit }) {
    if (!env.X_BEARER_TOKEN) return null;

    const url = new URL(SEARCH_URL);
    url.searchParams.set(
      "query",
      buildQuery(brandName, handle, domain, keywords, booleanQuery),
    );
    url.searchParams.set("tweet.fields", "public_metrics,created_at,author_id");
    url.searchParams.set("expansions", "author_id");
    url.searchParams.set("user.fields", "username,name,public_metrics");
    url.searchParams.set(
      "max_results",
      String(Math.min(Math.max(limit, 10), 100)),
    );

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${env.X_BEARER_TOKEN}` },
      cache: "no-store",
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as XApiResponse;
      const detail = body.errors?.[0]?.detail ?? body.detail ?? res.statusText;
      throw new Error(`X ${res.status}: ${detail}`);
    }
    const body = (await res.json()) as XApiResponse;
    const users = new Map((body.includes?.users ?? []).map((u) => [u.id, u]));

    return (body.data ?? []).map((t): NormalizedMention => {
      const user = users.get(t.author_id);
      return {
        platform: "x",
        id: t.id,
        text: t.text,
        url: user
          ? `https://x.com/${user.username}/status/${t.id}`
          : `https://x.com/i/web/status/${t.id}`,
        author: {
          name: user?.name ?? null,
          handle: user?.username ?? null,
          followerCount: user?.public_metrics?.followers_count,
        },
        createdAt: t.created_at,
        engagement: {
          score: t.public_metrics?.like_count,
          comments: t.public_metrics?.reply_count,
          shares: t.public_metrics?.retweet_count,
          impressions: t.public_metrics?.impression_count,
        },
      };
    });
  },
};
