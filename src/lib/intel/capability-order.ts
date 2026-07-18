import type { CapabilityKey } from "@/server/db/schema";
import { SIGNAL_CATALOG } from "./signal-catalog";

type ProducerDependencyMap = ReadonlyMap<
  CapabilityKey,
  ReadonlySet<CapabilityKey>
>;

/**
 * Producer edges come from `dependsOn` and nothing else — see
 * `signal-catalog.md` for the rationale (a `groupedWith` heuristic used to
 * be tried and was found to fabricate edges between siblings that don't
 * actually read each other's snapshot).
 */
function resolveProducerKeys(dependsOn: CapabilityKey[]): CapabilityKey[] {
  return dependsOn;
}

function buildPredecessorGraph(keys: CapabilityKey[]): {
  predecessorCount: Map<CapabilityKey, number>;
  dependents: Map<CapabilityKey, CapabilityKey[]>;
} {
  const keySet = new Set(keys);
  const predecessorCount = new Map<CapabilityKey, number>();
  const dependents = new Map<CapabilityKey, CapabilityKey[]>();

  for (const key of keys) {
    predecessorCount.set(key, 0);
  }

  for (const key of keys) {
    for (const producer of PRODUCER_DEPENDENCIES.get(key) ?? []) {
      if (!keySet.has(producer)) continue;
      predecessorCount.set(key, (predecessorCount.get(key) ?? 0) + 1);
      const list = dependents.get(producer) ?? [];
      list.push(key);
      dependents.set(producer, list);
    }
  }

  return { predecessorCount, dependents };
}

function buildProducerDependencyMap(): ProducerDependencyMap {
  const deps = new Map<CapabilityKey, Set<CapabilityKey>>();

  for (const spec of SIGNAL_CATALOG) {
    const producers = resolveProducerKeys(spec.dependsOn);
    for (const producer of producers) {
      if (producer === spec.capabilityKey) continue;
      const set = deps.get(spec.capabilityKey) ?? new Set();
      set.add(producer);
      deps.set(spec.capabilityKey, set);
    }
  }

  return deps;
}

const PRODUCER_DEPENDENCIES = buildProducerDependencyMap();

/** Direct producer capabilities that should run before `key` (catalog-derived). */
export function getCapabilityProducers(key: CapabilityKey): CapabilityKey[] {
  return [...(PRODUCER_DEPENDENCIES.get(key) ?? [])];
}

/**
 * Topological sort: producers before consumers. Unrelated keys keep their
 * relative input order (stable tie-break).
 */
export function sortCapabilitiesProducerFirst(
  keys: CapabilityKey[],
): CapabilityKey[] {
  if (keys.length <= 1) return [...keys];

  const originalIndex = new Map(keys.map((key, index) => [key, index]));
  const { predecessorCount, dependents } = buildPredecessorGraph(keys);

  const ready = keys
    .filter((key) => (predecessorCount.get(key) ?? 0) === 0)
    .sort((a, b) => (originalIndex.get(a) ?? 0) - (originalIndex.get(b) ?? 0));

  const sorted: CapabilityKey[] = [];

  while (ready.length > 0) {
    const current = ready.shift();
    if (!current) break;
    sorted.push(current);

    for (const dependent of dependents.get(current) ?? []) {
      const nextCount = (predecessorCount.get(dependent) ?? 1) - 1;
      predecessorCount.set(dependent, nextCount);
      if (nextCount === 0) {
        ready.push(dependent);
      }
    }

    ready.sort(
      (a, b) => (originalIndex.get(a) ?? 0) - (originalIndex.get(b) ?? 0),
    );
  }

  // Cycle fallback — append stragglers in original order.
  for (const key of keys) {
    if (!sorted.includes(key)) sorted.push(key);
  }

  return sorted;
}

/** Pending connector runs: producer capabilities first, FIFO by createdAt within rank. */
export function sortPendingRunsProducerFirst<
  T extends { capabilityKey: string; createdAt?: Date | null },
>(runs: T[]): T[] {
  if (runs.length <= 1) return [...runs];

  const uniqueKeys = [
    ...new Set(runs.map((run) => run.capabilityKey as CapabilityKey)),
  ];
  const rank = new Map(
    sortCapabilitiesProducerFirst(uniqueKeys).map((key, index) => [key, index]),
  );

  return [...runs].sort((a, b) => {
    const rankA =
      rank.get(a.capabilityKey as CapabilityKey) ?? Number.MAX_SAFE_INTEGER;
    const rankB =
      rank.get(b.capabilityKey as CapabilityKey) ?? Number.MAX_SAFE_INTEGER;
    if (rankA !== rankB) return rankA - rankB;

    const timeA = a.createdAt?.getTime() ?? 0;
    const timeB = b.createdAt?.getTime() ?? 0;
    return timeA - timeB;
  });
}
