import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import logger from "@/utils/logger";
import type { ClassifiedMention } from "../types";

/**
 * Test-only persistence: a single JSON file on disk. Not for production
 * (no concurrency guarantees beyond an in-process write queue, not durable
 * on serverless). Enough to make "over time" exist for the deferred signals.
 * Real persistence is `mention_records` (DB); this backs only the anonymous
 * `?domain=` test path. Lives under the OS temp dir so it also works in
 * read-only serverless filesystems (only /tmp is writable there).
 */

const STORE_PATH = join(tmpdir(), "runagents-mentions-store.json");

export type StoredMention = ClassifiedMention & {
  /** Brand/domain this mention was captured under (scopes the timeline). */
  brandKey: string;
  /** First time our scans observed this mention (ISO). */
  recordedAt: string;
};

type StoreShape = {
  version: 1;
  mentions: StoredMention[];
};

const EMPTY: StoreShape = { version: 1, mentions: [] };

// Serialize all writes within this process to avoid read-modify-write races.
let writeChain: Promise<void> = Promise.resolve();

async function readStore(): Promise<StoreShape> {
  try {
    const raw = await readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as StoreShape;
    if (parsed?.version === 1 && Array.isArray(parsed.mentions)) return parsed;
    return { ...EMPTY };
  } catch (err) {
    logger.debug("mentions store read failed", {
      module: "mentions",
      "error.message": err instanceof Error ? err.message : String(err),
    });
    return { ...EMPTY };
  }
}

async function writeStore(store: StoreShape): Promise<void> {
  await mkdir(dirname(STORE_PATH), { recursive: true });
  await writeFile(STORE_PATH, JSON.stringify(store), "utf8");
}

/**
 * Append newly-seen mentions for a brand. Dedup by brandKey+platform+id —
 * a mention seen in a later scan keeps its original recordedAt (so the
 * timeline reflects when it first appeared, not the latest scan).
 */
export async function persistMentions(
  brandKey: string,
  mentions: ClassifiedMention[],
): Promise<void> {
  if (mentions.length === 0) return;
  const now = new Date().toISOString();

  const task = writeChain.then(async () => {
    const store = await readStore();
    const seen = new Set(
      store.mentions.map((m) => `${m.brandKey}:${m.platform}:${m.id}`),
    );
    let added = 0;
    for (const m of mentions) {
      const key = `${brandKey}:${m.platform}:${m.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      store.mentions.push({ ...m, brandKey, recordedAt: now });
      added += 1;
    }
    if (added > 0) await writeStore(store);
  });

  writeChain = task.catch((err) => {
    logger.warn("[mentions] persist failed", {
      err: err instanceof Error ? err.message : String(err),
    });
  });
  return writeChain;
}

export async function loadMentions(brandKey: string): Promise<StoredMention[]> {
  const store = await readStore();
  return store.mentions.filter((m) => m.brandKey === brandKey);
}

export async function storeStats(): Promise<{
  totalMentions: number;
  brands: string[];
}> {
  const store = await readStore();
  return {
    totalMentions: store.mentions.length,
    brands: [...new Set(store.mentions.map((m) => m.brandKey))],
  };
}
