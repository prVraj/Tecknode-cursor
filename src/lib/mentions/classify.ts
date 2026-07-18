import { z } from "zod";
import { intelGenerateObject } from "@/lib/intel/llm/client";
import { resolveIntelPrompt } from "@/lib/intel/prompts/resolve";
import logger from "@/utils/logger";
import {
  type Classification,
  type ClassifiedMention,
  type NormalizedMention,
  type Priority,
  SENTIMENTS,
  type Sentiment,
  SIGNAL_TYPES,
  type SignalType,
} from "./types";

const INFLUENCER_THRESHOLD = 10_000;
/** Cap text fed to the LLM so prompt size stays bounded. */
const MAX_TEXT = 360;
/** Hard cap on mentions classified per search (cost/latency ceiling). */
const MAX_CLASSIFY = 150;

const SENTIMENT_SET = new Set<Sentiment>(["positive", "neutral", "negative"]);
const SIGNAL_SET = new Set<SignalType>(SIGNAL_TYPES);

/**
 * Builds the relevance rule the LLM applies per item. Brand monitoring requires
 * the item to be about the company; keyword monitoring requires it to be on the
 * topic/category (the brand need NOT be named — that's the whole point of
 * keyword tracking: catch buying-intent/comparison conversations).
 */
function relevanceContext(ctx?: ClassifyContext): string {
  const mode = ctx?.mode ?? "brand";
  const brand = ctx?.brandName?.trim();

  if (mode === "keyword") {
    const topics = (ctx?.keywords ?? []).filter(Boolean);
    const topic = topics.length ? topics.join(", ") : brand;
    if (!topic) return "";
    return `RELEVANCE RULE: this is KEYWORD / topic monitoring for the category: ${topic}. rel=1 if the item genuinely discusses this topic/category — the brand need NOT be named, so buying-intent ("looking for…"), comparisons ("X vs Y"), and category discussion all count. rel=0 only for off-topic / coincidental matches or spam.\n\n`;
  }

  if (!brand) return "";
  const domain = ctx?.domain?.trim();
  return `BRAND: ${brand}${domain ? ` (${domain})` : ""}\nRELEVANCE RULE: rel=1 only if the item is genuinely about THIS company. rel=0 for a coincidental match (different meaning of the word, unrelated post that merely contains the term, spam).\n\n`;
}

export type ClassifyContext = {
  brandName?: string;
  domain?: string;
  keywords?: string[];
  mode?: "brand" | "keyword";
};

/**
 * Strict schema for the structured-output call. Driving this through
 * `generateObject` instead of `chat() + JSON.parse` means the LLM is forced
 * into valid JSON matching the shape — no more "Expected double-quoted
 * property name" parse failures on long outputs.
 */
// Azure's structured-output (gpt-4o-mini upstream) rejects schemas where any
// property in `properties` is missing from `required` — `.optional()` fields
// trip that. So every field has to be REQUIRED. `rel` is still typed loosely
// (number OR string) because the LLM is reliably casual about that one even
// in strict mode; the consumer normalizes via `isRelevantFlag`.
const ClassifyItemSchema = z.object({
  i: z.number().int().min(0),
  rel: z.union([z.number(), z.string()]),
  s: z.enum(SENTIMENTS),
  g: z.enum(SIGNAL_TYPES),
});
const ClassifyResponseSchema = z.object({
  r: z.array(ClassifyItemSchema),
});
type ClassifyItem = z.infer<typeof ClassifyItemSchema>;

function clip(s: string): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > MAX_TEXT ? `${t.slice(0, MAX_TEXT)}…` : t;
}

function derivePriority(signal: SignalType, sentiment: Sentiment): Priority {
  if (
    signal === "churn" ||
    signal === "positive_churn" ||
    signal === "comparison" ||
    signal === "buying_intent"
  ) {
    return "P0";
  }
  if (signal === "pain_point" || signal === "feature_request") return "P1";
  if (sentiment === "negative") return "P1";
  return "P2";
}

function isInfluencer(m: NormalizedMention): boolean {
  return (m.author.followerCount ?? 0) >= INFLUENCER_THRESHOLD;
}

function neutralClassification(m: NormalizedMention): Classification {
  return {
    sentiment: "neutral",
    signalType: "brand_mention",
    priority: "P2",
    isInfluencer: isInfluencer(m),
    // Default relevant — only an explicit LLM "rel:0" marks a mention irrelevant,
    // so an LLM miss/failure never silently drops real mentions.
    isRelevant: true,
  };
}

function isRelevantFlag(rel: ClassifyItem["rel"]): boolean {
  // Only an explicit 0 (or "0") marks irrelevant. Missing or any other value
  // → relevant. Mirrors the old loose-JSON behavior so we don't silently drop
  // mentions when the LLM omits `rel`.
  return rel !== 0 && rel !== "0";
}

/**
 * Classifies mentions in one batched LLM call. Items beyond MAX_CLASSIFY
 * (lowest-engagement first) and any the LLM misses fall back to a neutral
 * brand_mention classification — never null, never throws.
 */
export async function classifyMentions(
  mentions: NormalizedMention[],
  ctx?: ClassifyContext,
): Promise<ClassifiedMention[]> {
  if (mentions.length === 0) return [];

  // Prioritize highest-engagement mentions for the LLM budget.
  const order = mentions
    .map((m, idx) => ({ idx, score: m.engagement.score ?? 0 }))
    .sort((a, b) => b.score - a.score);
  const toClassify = new Set(order.slice(0, MAX_CLASSIFY).map((o) => o.idx));

  const indexed = mentions
    .map((m, idx) => ({ m, idx }))
    .filter(({ idx }) => toClassify.has(idx));

  const userMessage = `${relevanceContext(ctx)}${indexed
    .map(({ m, idx }) => `[${idx}] (${m.platform}) ${clip(m.text)}`)
    .join("\n")}\n\nReturn the JSON now.`;

  const byIndex = new Map<
    number,
    { s: Sentiment; g: SignalType; rel: boolean }
  >();
  const { system, promptName, promptVersion, promptLabel } =
    await resolveIntelPrompt("mentionsClassify");
  const { data, dataIssue } = await intelGenerateObject({
    modelTier: "scoring",
    system,
    promptName,
    promptVersion,
    promptLabel,
    prompt: userMessage,
    schema: ClassifyResponseSchema,
    temperature: 0,
    maxTokens: 4000,
  });
  if (dataIssue || !data) {
    logger.warn("[mentions] classify failed — falling back to neutral", {
      err: dataIssue ?? "no data returned",
    });
  } else {
    for (const item of data.r) {
      // The schema already validates `s` and `g` against the canonical enums;
      // the runtime sets stay only as a guard against bad enum drift on the
      // shared type files.
      if (SENTIMENT_SET.has(item.s) && SIGNAL_SET.has(item.g)) {
        byIndex.set(item.i, {
          s: item.s,
          g: item.g,
          rel: isRelevantFlag(item.rel),
        });
      }
    }
  }

  return mentions.map((m, idx): ClassifiedMention => {
    const hit = byIndex.get(idx);
    if (!hit) return { ...m, classification: neutralClassification(m) };
    return {
      ...m,
      classification: {
        sentiment: hit.s,
        signalType: hit.g,
        priority: derivePriority(hit.g, hit.s),
        isInfluencer: isInfluencer(m),
        isRelevant: hit.rel,
      },
    };
  });
}
