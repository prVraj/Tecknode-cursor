import { env } from "@/env/server";
import type { NormalizedMention, PlatformClient } from "../types";

const TOKEN_URL = "https://www.reddit.com/api/v1/access_token";
const SEARCH_URL = "https://oauth.reddit.com/search";
const USER_AGENT = "runagents-mentions/1.0";

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.value;
  }
  if (!(env.REDDIT_CLIENT_ID && env.REDDIT_SECRET)) {
    throw new Error("Reddit creds missing");
  }
  const basic = Buffer.from(
    `${env.REDDIT_CLIENT_ID}:${env.REDDIT_SECRET}`,
  ).toString("base64");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": USER_AGENT,
    },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Reddit auth ${res.status}: ${res.statusText}`);
  const body = (await res.json()) as {
    access_token: string;
    expires_in: number;
  };
  cachedToken = {
    value: body.access_token,
    expiresAt: Date.now() + (body.expires_in - 60) * 1000,
  };
  return cachedToken.value;
}

type Listing = {
  data?: {
    children?: Array<{
      kind: string;
      data: {
        id: string;
        title?: string;
        selftext?: string;
        author?: string;
        subreddit?: string;
        permalink?: string;
        score?: number;
        num_comments?: number;
        upvote_ratio?: number;
        created_utc?: number;
      };
    }>;
  };
};

export const redditClient: PlatformClient = {
  platform: "reddit",
  async search({ brandName, domain, keywords, limit }) {
    if (!(env.REDDIT_CLIENT_ID && env.REDDIT_SECRET)) return null;

    const token = await getToken();
    const url = new URL(SEARCH_URL);
    const terms = [`"${brandName}"`, domain, ...keywords]
      .map((t) => t.trim())
      .filter(Boolean);
    url.searchParams.set("q", terms.join(" OR "));
    url.searchParams.set("sort", "new");
    url.searchParams.set("limit", String(Math.min(limit, 100)));
    url.searchParams.set("type", "link");

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": USER_AGENT,
      },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Reddit ${res.status}: ${res.statusText}`);
    const body = (await res.json()) as Listing;

    return (body.data?.children ?? []).map((c): NormalizedMention => {
      const d = c.data;
      const text = d.selftext
        ? `${d.title ?? ""}\n\n${d.selftext}`.trim()
        : (d.title ?? "");
      return {
        platform: "reddit",
        id: d.id,
        text,
        url: d.permalink
          ? `https://www.reddit.com${d.permalink}`
          : `https://www.reddit.com/comments/${d.id}`,
        author: { name: d.author ?? null, handle: d.author ?? null },
        createdAt: d.created_utc
          ? new Date(d.created_utc * 1000).toISOString()
          : new Date().toISOString(),
        engagement: { score: d.score, comments: d.num_comments },
        context: d.subreddit ? `r/${d.subreddit}` : undefined,
      };
    });
  },
};
