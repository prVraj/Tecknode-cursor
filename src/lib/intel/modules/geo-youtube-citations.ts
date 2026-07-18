import { buildCitationSourcesResponse } from "@/lib/intel/citation-sources";
import type { ModuleRunner } from "../dispatcher";
import {
  asOutput,
  getCompetitorDomains,
  getPrompts,
  requireEnv,
} from "./module-helpers";

// Pull the channel identifier from the entity's configured YouTube social
// (URL or bare handle) — e.g. "https://youtube.com/@acme" → "acme". Used to
// attribute citations to *your* channel instead of guessing from the domain.
function extractYoutubeHandle(
  youtube: string | null | undefined,
): string | null {
  if (!youtube?.trim()) return null;
  const raw = youtube.trim();
  const match = raw.match(/(?:@|\/c\/|\/channel\/|\/user\/)([^/?#\s]+)/i);
  if (match?.[1]) return match[1].toLowerCase();
  return raw.replace(/^@/, "").toLowerCase();
}

function extractYoutubeCitations(
  topDomains: {
    domain: string;
    citationCount: number;
    frequency: number;
    exampleUrls?: string[];
  }[],
  competitors: string[],
) {
  const youtubeEntries = topDomains.filter((d) =>
    d.domain.includes("youtube.com"),
  );

  const competitorYoutubeCitations = competitors.map((comp) => {
    const entry = youtubeEntries.find((d) =>
      d.exampleUrls?.some((u) => u.includes(comp)),
    );
    return { domain: comp, citationCount: entry?.citationCount ?? 0 };
  });

  return { youtubeEntries, competitorYoutubeCitations };
}

export const runGeoYoutubeCitations: ModuleRunner = async ({
  userId,
  entity,
}) => {
  const apiKey = requireEnv("OPENROUTER_API_KEY", "geo_youtube_citations");
  const competitors = await getCompetitorDomains({ userId, entity });

  const citationData = await buildCitationSourcesResponse({
    prompts: getPrompts(entity),
    yourDomain: entity.domain,
    competitors,
    apiKey,
  });

  const { youtubeEntries, competitorYoutubeCitations } =
    extractYoutubeCitations(citationData.topDomains, competitors);

  const rawPayload =
    (entity.payload as { socials?: { youtube?: string | null } } | null) ?? {};
  const youtubeHandle = extractYoutubeHandle(rawPayload.socials?.youtube);

  const dataIssues = [...(citationData.dataIssues ?? [])];
  // Only attribute citations to your channel when a real handle is configured.
  // Without one we report null (no score) rather than a misleading 0 from the
  // old domain-prefix guess.
  let yourYoutubeCitationCount: number | null;
  if (youtubeHandle) {
    yourYoutubeCitationCount = youtubeEntries.filter(
      (d) =>
        d.exampleUrls?.some((u) => u.toLowerCase().includes(youtubeHandle)) ??
        false,
    ).length;
  } else {
    yourYoutubeCitationCount = null;
    dataIssues.push(
      "No YouTube channel configured for this entity — cannot attribute citations to your channel.",
    );
  }

  const output = {
    source: "openrouter/perplexity" as const,
    domain: entity.domain,
    dataIssues,
    yourYoutubeCitationCount,
    youtubeCitations: youtubeEntries.map((d) => ({
      url: d.exampleUrls?.[0] ?? `https://youtube.com`,
      citedInPrompts: [],
      frequency: d.frequency,
    })),
    competitorYoutubeCitations,
    totalYoutubeSourcesInSpace: youtubeEntries.length,
  };

  return { output: asOutput(output), signals: [], costUnits: 2 };
};
