import { env } from "@/env/server";
import { peekCache, primeCache } from "../store/author-cache";
import type { NormalizedMention, PlatformClient } from "../types";

const API = "https://www.googleapis.com/youtube/v3";

type SearchItem = {
  id: { videoId?: string };
  snippet: {
    title: string;
    description: string;
    channelTitle: string;
    channelId: string;
    publishedAt: string;
  };
};

/**
 * Batch a `<resource>.list` stats call (≤50 ids), cache each id, and return
 * a per-id number map. Used for channel subscribers (#12) and video views
 * (#22) — neither is in search.list, both are quota-expensive without caching.
 */
async function fetchStats(
  resource: "channels" | "videos",
  ids: string[],
  key: string,
  pick: (stats: Record<string, string | undefined>) => number | undefined,
): Promise<Map<string, number | undefined>> {
  const out = new Map<string, number | undefined>();
  const misses: string[] = [];
  for (const id of ids) {
    const c = peekCache<number | undefined>(`youtube:${resource}:${id}`);
    if (c.hit) out.set(id, c.value);
    else misses.push(id);
  }

  for (let i = 0; i < misses.length; i += 50) {
    const chunk = misses.slice(i, i + 50);
    const u = new URL(`${API}/${resource}`);
    u.searchParams.set("part", "statistics");
    u.searchParams.set("id", chunk.join(","));
    u.searchParams.set("key", key);
    const r = await fetch(u, { cache: "no-store" });
    if (!r.ok) {
      for (const id of chunk) out.set(id, undefined);
      continue;
    }
    const data = (await r.json()) as {
      items?: Array<{ id: string; statistics?: Record<string, string> }>;
    };
    for (const it of data.items ?? []) {
      const v = pick(it.statistics ?? {});
      out.set(it.id, v);
      primeCache(`youtube:${resource}:${it.id}`, v);
    }
  }
  return out;
}

const toNum = (s: string | undefined): number | undefined =>
  s == null ? undefined : Number(s);

export const youtubeClient: PlatformClient = {
  platform: "youtube",
  async search({ brandName, limit }) {
    if (!env.YOUTUBE_API_KEY) return null;
    const key = env.YOUTUBE_API_KEY;

    const url = new URL(`${API}/search`);
    url.searchParams.set("part", "snippet");
    url.searchParams.set("q", brandName);
    url.searchParams.set("type", "video");
    url.searchParams.set("order", "date");
    url.searchParams.set("maxResults", String(Math.min(limit, 50)));
    url.searchParams.set("key", key);

    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`YouTube ${res.status}: ${res.statusText}`);
    const body = (await res.json()) as { items?: SearchItem[] };
    // YouTube can return items without a snippet (deleted/private videos);
    // require both the videoId and snippet so the map below can't crash.
    const items = (body.items ?? []).filter((i) => i.id.videoId && i.snippet);

    const videoIds = [...new Set(items.map((i) => i.id.videoId as string))];
    const channelIds = [
      ...new Set(items.map((i) => i.snippet?.channelId).filter((c) => !!c)),
    ] as string[];
    const [views, subs] = await Promise.all([
      fetchStats("videos", videoIds, key, (s) => toNum(s.viewCount)), // #22
      fetchStats("channels", channelIds, key, (s) => toNum(s.subscriberCount)), // #12
    ]);

    return items.map((i): NormalizedMention => {
      const videoId = i.id.videoId as string;
      return {
        platform: "youtube",
        id: videoId,
        text: `${i.snippet.title} — ${i.snippet.description}`.trim(),
        url: `https://www.youtube.com/watch?v=${videoId}`,
        author: {
          name: i.snippet.channelTitle,
          handle: i.snippet.channelId,
          followerCount: subs.get(i.snippet.channelId),
        },
        createdAt: i.snippet.publishedAt,
        engagement: { impressions: views.get(videoId) },
        context: i.snippet.channelTitle,
      };
    });
  },
};
