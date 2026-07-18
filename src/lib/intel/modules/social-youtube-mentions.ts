import { env } from "@/env/server";
import { openrouterFetch } from "@/lib/intel/clients/openrouter-chat";
import { signalSnapshotRepo } from "@/server/db/repos/signal-snapshot.repo";
import type { NewSignal } from "@/server/db/schema";
import type { ModuleRunner } from "../dispatcher";
import { asOutput, getBrand, requireEnv } from "./module-helpers";

const YT_API = "https://www.googleapis.com/youtube/v3";

type VideoContext =
  | "review"
  | "tutorial"
  | "comparison"
  | "news"
  | "unboxing"
  | "other";

type VideoResult = {
  videoId: string;
  title: string;
  channelId: string;
  channelTitle: string;
  publishedAt: string;
  viewCount: number | null;
  context: VideoContext;
};

async function searchVideos(
  brand: string,
  apiKey: string,
): Promise<
  {
    videoId: string;
    title: string;
    channelId: string;
    channelTitle: string;
    publishedAt: string;
  }[]
> {
  const thirtyDaysAgo = new Date(
    Date.now() - 30 * 24 * 60 * 60 * 1000,
  ).toISOString();
  const url = new URL(`${YT_API}/search`);
  url.searchParams.set("q", brand);
  url.searchParams.set("type", "video");
  url.searchParams.set("order", "viewCount");
  url.searchParams.set("publishedAfter", thirtyDaysAgo);
  url.searchParams.set("maxResults", "25");
  url.searchParams.set("part", "snippet");
  url.searchParams.set("key", apiKey);

  const res = await fetch(url);
  if (!res.ok) return [];
  const data = (await res.json()) as {
    items?: {
      id?: { videoId?: string };
      snippet?: {
        title?: string;
        channelId?: string;
        channelTitle?: string;
        publishedAt?: string;
      };
    }[];
  };
  return (data.items ?? [])
    .map((item) => ({
      videoId: item.id?.videoId ?? "",
      title: item.snippet?.title ?? "",
      channelId: item.snippet?.channelId ?? "",
      channelTitle: item.snippet?.channelTitle ?? "",
      publishedAt: item.snippet?.publishedAt ?? "",
    }))
    .filter((v) => v.videoId);
}

async function fetchViewCounts(
  videoIds: string[],
  apiKey: string,
): Promise<Map<string, number>> {
  if (videoIds.length === 0) return new Map();
  const url = new URL(`${YT_API}/videos`);
  url.searchParams.set("id", videoIds.join(","));
  url.searchParams.set("part", "statistics");
  url.searchParams.set("key", apiKey);

  const res = await fetch(url);
  if (!res.ok) return new Map();
  const data = (await res.json()) as {
    items?: { id?: string; statistics?: { viewCount?: string } }[];
  };
  const map = new Map<string, number>();
  for (const item of data.items ?? []) {
    if (item.id)
      map.set(item.id, Number.parseInt(item.statistics?.viewCount ?? "0", 10));
  }
  return map;
}

async function classifyVideoContexts(
  titles: string[],
  apiKey: string,
): Promise<VideoContext[]> {
  if (titles.length === 0) return [];
  const res = await openrouterFetch("social-youtube-mentions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Classify each video title. Return JSON: {contexts: string[]} where each is: review|tutorial|comparison|news|unboxing|other",
        },
        {
          role: "user",
          content: titles.map((t, i) => `${i + 1}. ${t}`).join("\n"),
        },
      ],
    }),
  });
  if (!res.ok) return titles.map(() => "other");
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  try {
    const parsed = JSON.parse(data.choices?.[0]?.message?.content ?? "{}") as {
      contexts?: VideoContext[];
    };
    return parsed.contexts ?? titles.map(() => "other" as VideoContext);
  } catch {
    return titles.map(() => "other" as VideoContext);
  }
}

export const runSocialYoutubeMentions: ModuleRunner = async ({
  userId,
  entity,
  run,
}) => {
  const ytApiKey = env.YOUTUBE_API_KEY?.trim();
  if (!ytApiKey)
    throw new Error("YOUTUBE_API_KEY required for social_youtube_mentions");
  const apiKey = requireEnv("OPENROUTER_API_KEY", "social_youtube_mentions");
  const brand = getBrand(entity);

  const rawVideos = await searchVideos(brand, ytApiKey);
  const videoIds = rawVideos.map((v) => v.videoId);
  const [viewCounts, contexts] = await Promise.all([
    fetchViewCounts(videoIds, ytApiKey),
    classifyVideoContexts(
      rawVideos.map((v) => v.title),
      apiKey,
    ),
  ]);

  const videos: VideoResult[] = rawVideos.map((v, i) => ({
    ...v,
    viewCount: viewCounts.get(v.videoId) ?? null,
    context: contexts[i] ?? "other",
  }));

  const totalReach = videos.reduce((sum, v) => sum + (v.viewCount ?? 0), 0);
  const contextBreakdown: Record<string, number> = {};
  for (const v of videos) {
    contextBreakdown[v.context] = (contextBreakdown[v.context] ?? 0) + 1;
  }

  const prev = await signalSnapshotRepo.findLatest(
    entity.id,
    "social_youtube_mentions",
  );
  const signals: NewSignal[] = [];
  const dedupKey = `social_youtube_mentions:${entity.id}`;
  const topVideos = videos.slice(0, 3);

  if (!prev) {
    signals.push({
      userId,
      subjectEntityId: entity.id,
      capabilityKey: "social_youtube_mentions",
      severity: "p3",
      title: `${brand} YouTube baseline: ${videos.length} videos, ${totalReach.toLocaleString()} total views`,
      summary: `${videos.length} videos in last 30 days. Top context: ${Object.entries(contextBreakdown).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "other"}.`,
      evidence: {
        sourceUrl: `https://www.youtube.com/results?search_query=${encodeURIComponent(brand)}`,
        runId: run.id,
        details: {
          baseline: true,
          videoCount: videos.length,
          totalReach,
          topVideos,
        },
      },
      confidence: "0.8",
      dedupKey,
    });
  } else {
    const prevReach =
      ((prev.payload as Record<string, unknown>)?.totalReach as
        | number
        | undefined) ?? 0;
    if (prevReach > 0 && totalReach >= prevReach * 2) {
      const capturedDate = new Date().toISOString().slice(0, 10);
      signals.push({
        userId,
        subjectEntityId: entity.id,
        capabilityKey: "social_youtube_mentions",
        severity: "p2",
        title: `${brand} YouTube reach doubled: ${totalReach.toLocaleString()} views (was ${prevReach.toLocaleString()})`,
        summary: `YouTube reach increased 2x this period. ${videos.length} videos tracked.`,
        evidence: {
          sourceUrl: `https://www.youtube.com/results?search_query=${encodeURIComponent(brand)}`,
          runId: run.id,
          details: { totalReach, prevReach, topVideos },
        },
        confidence: "0.8",
        dedupKey: `${dedupKey}:spike:${capturedDate}`,
      });
    }
  }

  return {
    output: asOutput({
      source: "youtube+openrouter",
      brand,
      dataIssues: [],
      videoCount: videos.length,
      totalReach,
      videos: videos.slice(0, 10),
      contextBreakdown,
    }),
    signals,
    costUnits: 2,
  };
};
