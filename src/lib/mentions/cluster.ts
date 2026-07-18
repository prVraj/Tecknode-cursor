import { chat } from "@/lib/intel/clients/openrouter-raw-chat";
import { logExternalFailure } from "@/utils/log-external";
import type { ClassifiedMention } from "./types";

/** #24 — group mentions into topic clusters in one LLM call (no history). */

const MAX_INPUT = 120; // cap mentions sent to the model
const MAX_TEXT = 200; // clip each mention

export type TopicCluster = {
  label: string;
  count: number;
  sampleIds: string[];
};

const SYSTEM_PROMPT = `You group brand mentions into topic clusters for a competitive-intelligence dashboard.

Return ONLY JSON: { "clusters": [ { "label": "<3-5 word theme>", "ids": ["<id>", ...] } ] }
- 3 to 8 clusters, each a distinct recurring theme (a subject people discuss)
- "label" is a short human topic (e.g. "pricing complaints", "video quality") — NOT a sentiment
- each id belongs to at most one cluster; drop ids that fit no theme
- no prose outside the JSON`;

export async function clusterTopics(
  mentions: ClassifiedMention[],
): Promise<TopicCluster[]> {
  if (mentions.length < 3) return [];

  const sample = mentions.slice(0, MAX_INPUT);
  const userMessage = `${sample
    .map((m) => `[${m.id}] ${m.text.replace(/\s+/g, " ").slice(0, MAX_TEXT)}`)
    .join("\n")}\n\nReturn the JSON now.`;

  let text: string;
  try {
    text = await chat(SYSTEM_PROMPT, userMessage, {
      temperature: 0.2,
      maxTokens: 1500,
    });
  } catch (err) {
    logExternalFailure("openrouter", "cluster.clusterTopics", err);
    return [];
  }

  try {
    const cleaned = text
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "");
    const parsed = JSON.parse(cleaned) as {
      clusters?: Array<{ label?: string; ids?: string[] }>;
    };
    return (parsed.clusters ?? [])
      .map((c) => ({
        label: c.label ?? "untitled",
        count: c.ids?.length ?? 0,
        sampleIds: (c.ids ?? []).slice(0, 5),
      }))
      .filter((c) => c.count > 0);
  } catch (err) {
    logExternalFailure("openrouter", "cluster.clusterTopics", err);
    return [];
  }
}
