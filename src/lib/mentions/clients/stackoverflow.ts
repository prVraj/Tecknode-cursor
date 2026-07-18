import type { NormalizedMention, PlatformClient } from "../types";

type Question = {
  question_id: number;
  title: string;
  body?: string;
  link: string;
  owner?: { display_name?: string; user_id?: number };
  creation_date: number;
  score: number;
  answer_count: number;
  view_count?: number;
  tags?: string[];
};

export const stackoverflowClient: PlatformClient = {
  platform: "stackoverflow",
  async search({ brandName, limit }) {
    const url = new URL("https://api.stackexchange.com/2.3/search/advanced");
    url.searchParams.set("q", brandName);
    url.searchParams.set("site", "stackoverflow");
    url.searchParams.set("order", "desc");
    url.searchParams.set("sort", "creation");
    url.searchParams.set("pagesize", String(Math.min(limit, 100)));

    // Stack Exchange wants a User-Agent; without it requests get throttled.
    const res = await fetch(url, {
      headers: { "User-Agent": "RunAgents-Mentions/1.0" },
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`StackOverflow ${res.status}: ${res.statusText}`);
    }
    const body = (await res.json()) as { items?: Question[] };

    return (body.items ?? []).map(
      (q): NormalizedMention => ({
        platform: "stackoverflow",
        id: String(q.question_id),
        text: q.title,
        url: q.link,
        author: {
          name: q.owner?.display_name ?? null,
          handle: q.owner?.user_id ? String(q.owner.user_id) : null,
        },
        createdAt: new Date(q.creation_date * 1000).toISOString(),
        engagement: {
          score: q.score,
          comments: q.answer_count,
          impressions: q.view_count,
        },
        context: q.tags?.join(", "),
      }),
    );
  },
};
