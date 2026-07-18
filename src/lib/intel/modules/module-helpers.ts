import { env } from "@/env/server";
import { unwrapSnapshotPayload } from "@/lib/intel/provenance";
import { signalSnapshotRepo } from "@/server/db/repos/signal-snapshot.repo";
import { trackedEntityRepo } from "@/server/db/repos/tracked-entity.repo";
import type { CapabilityKey, TrackedEntity } from "@/server/db/schema";
import type { StoredDataIssue } from "../connector-output";
import type { ModuleRunContext } from "../dispatcher";

type EnvKey =
  | "DATAFORSEO_LOGIN"
  | "DATAFORSEO_PASSWORD"
  | "FIRECRAWL_API_KEY"
  | "OPENROUTER_API_KEY";

type EntityPayload = TrackedEntity["payload"] & Record<string, unknown>;

function payloadFor(entity: TrackedEntity): EntityPayload {
  return entity.payload as EntityPayload;
}

export function asOutput(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return { value };
}

/**
 * "Today-else-compute" sibling-snapshot read for computed signals: returns a
 * producer snapshot's payload only when it was captured today (UTC), so a
 * consumer can reuse same-day work and fall back to recomputing otherwise.
 *
 * Returns null for both "no snapshot" and "stale snapshot" — the caller treats
 * both as "recompute". `today` should be `new Date().toISOString().slice(0, 10)`.
 */
export async function readTodaySnapshotPayload<T>(
  entityId: string,
  capabilityKey: CapabilityKey,
  today: string,
): Promise<T | null> {
  const snap = await signalSnapshotRepo.findLatest(entityId, capabilityKey);
  return snap && snap.capturedDate === today
    ? unwrapSnapshotPayload<T>(snap.payload)
    : null;
}

export type DependencySnapshot<T> =
  | { ok: true; payload: T; producerDataIssues: StoredDataIssue[] }
  | { ok: false; dataIssues: StoredDataIssue[] };

/**
 * Read a producer capability's same-day snapshot for a derived module,
 * surfacing the producer's own `dataIssues` so the caller can copy them into
 * its own output.
 *
 * That copy is mandatory, not defensive: a producer that ran on a degraded
 * sample still returns a structurally valid payload — only its top-level
 * `dataIssues[]` records that the sample was compromised. A derived module
 * that reads a field without also propagating `dataIssues` will compute a
 * confident number from a degraded sample and persist/diff it as if healthy.
 *
 * On a missing or stale producer snapshot, returns `ok: false` with a
 * MISSING_DEPENDENCY issue. Callers soft-fail at `costUnits: 0` rather than
 * re-probing.
 */
export async function readDependencySnapshot<
  T extends { dataIssues?: unknown },
>(
  entityId: string,
  producerKey: CapabilityKey,
  today: string,
): Promise<DependencySnapshot<T>> {
  const payload = await readTodaySnapshotPayload<T>(
    entityId,
    producerKey,
    today,
  );
  if (!payload) {
    return {
      ok: false,
      dataIssues: [
        {
          code: "MISSING_DEPENDENCY",
          detail: `No same-day ${producerKey} snapshot`,
        },
      ],
    };
  }
  return {
    ok: true,
    payload,
    producerDataIssues: Array.isArray(payload.dataIssues)
      ? (payload.dataIssues as StoredDataIssue[])
      : [],
  };
}

export function requireEnv(key: EnvKey, capability: string): string {
  const value = env[key]?.trim();
  if (!value) {
    throw new Error(`${key} required for capability ${capability}`);
  }
  return value;
}

export function getDataForSeoCredentials(capability: string): {
  login: string;
  password: string;
} {
  return {
    login: requireEnv("DATAFORSEO_LOGIN", capability),
    password: requireEnv("DATAFORSEO_PASSWORD", capability),
  };
}

export async function getCompetitorDomains({
  userId,
  entity,
}: Pick<ModuleRunContext, "userId" | "entity">): Promise<string[]> {
  const allEntities = await trackedEntityRepo.listByUser(userId);
  return allEntities
    .filter((item) => item.id !== entity.id && item.role === "competitor")
    .map((item) => item.domain);
}

export function getBrand(entity: TrackedEntity): string {
  return entity.brandName ?? entity.domain;
}

export function getKeywords(entity: TrackedEntity): string[] {
  const keywords = payloadFor(entity).keywords;
  return Array.isArray(keywords)
    ? keywords.filter(
        (keyword): keyword is string => typeof keyword === "string",
      )
    : [];
}

export function getPrompts(entity: TrackedEntity): string[] {
  const keywords = getKeywords(entity);
  return keywords.length > 0 ? keywords : [getBrand(entity)];
}

export function getLocation(entity: TrackedEntity): string | undefined {
  const location = payloadFor(entity).location;
  if (typeof location !== "string" || !location.trim()) return undefined;
  // "Global" means no location filter — treat as undefined so APIs return worldwide results
  if (location.trim().toLowerCase() === "global") return undefined;
  return location.trim();
}

export function getLocationLabel(entity: TrackedEntity): string {
  const loc = payloadFor(entity).location;
  return typeof loc === "string" && loc.trim() ? loc.trim() : "United States";
}

export function getNumberPayload(
  entity: TrackedEntity,
  key: string,
  fallback: number,
): number {
  const value = payloadFor(entity)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function getStringArrayPayload(
  entity: TrackedEntity,
  key: string,
): string[] {
  const value = payloadFor(entity)[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export function urlForDomain(domain: string): string {
  return /^https?:\/\//i.test(domain) ? domain : `https://${domain}`;
}

export function getEntityUrl(entity: TrackedEntity): string {
  const url = payloadFor(entity).url;
  return typeof url === "string" && url.trim()
    ? url
    : urlForDomain(entity.domain);
}

export function getEntityUrls(entity: TrackedEntity): string[] {
  const urls = getStringArrayPayload(entity, "urls");
  return urls.length > 0 ? urls : [getEntityUrl(entity)];
}

const MAX_MONEY_PAGES = 25;

/**
 * Resolve an entity's "money pages" to absolute URLs for the SEO indexing
 * signals. Source priority: `payload.watchedPaths` (paths or full URLs) →
 * `fallback` (e.g. top sitemap URLs) → the entity homepage. Paths are resolved
 * against the entity origin and capped at {@link MAX_MONEY_PAGES} to bound cost.
 */
export function getMoneyPageUrls(
  entity: TrackedEntity,
  fallback: string[] = [],
): string[] {
  const base = getEntityUrl(entity);
  let origin: string;
  try {
    origin = new URL(base).origin;
  } catch {
    origin = base;
  }

  const watched = getStringArrayPayload(entity, "watchedPaths");
  const raw =
    watched.length > 0 ? watched : fallback.length > 0 ? fallback : [base];

  const resolved = raw
    .map((entry) => {
      try {
        return new URL(entry, `${origin}/`).toString();
      } catch {
        return null;
      }
    })
    .filter((url): url is string => url !== null);

  return [...new Set(resolved)].slice(0, MAX_MONEY_PAGES);
}

export function getCountries(entity: TrackedEntity): string[] {
  const countries = getStringArrayPayload(entity, "countries");
  return countries.length > 0 ? countries.slice(0, 5) : ["United States"];
}

export function getKnownFacts(entity: TrackedEntity): {
  description?: string;
  founded?: string;
  pricing?: string;
  features?: string[];
  doesNotDo?: string[];
  headquarters?: string;
  customFacts?: string[];
} {
  const payload = payloadFor(entity);
  const knownFacts = payload.knownFacts;
  if (
    knownFacts &&
    typeof knownFacts === "object" &&
    !Array.isArray(knownFacts)
  ) {
    return knownFacts as ReturnType<typeof getKnownFacts>;
  }

  return {
    description: typeof payload.notes === "string" ? payload.notes : undefined,
    customFacts: [`Domain: ${entity.domain}`],
  };
}
