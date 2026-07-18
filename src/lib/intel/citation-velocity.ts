export type VelocityTrend =
  | "accelerating"
  | "stable"
  | "decelerating"
  | "new_entry"
  | "dropped_out";

export type DomainVelocity = {
  domain: string;
  baselineFrequency: number | null;
  currentFrequency: number;
  deltaFrequency: number | null;
  velocityPercent: number | null;
  trend: VelocityTrend;
  isYourDomain: boolean;
};

export type CitationVelocityResponse = {
  source: "computed";
  yourDomain: string | null;
  snapshotInterval: string | null;
  dataIssues: string[];
  domains: DomainVelocity[];
  yourDomainVelocity: DomainVelocity | null;
  marketLeader: string | null;
  biggestGainer: DomainVelocity | null;
  biggestLoser: DomainVelocity | null;
};

type FrequencyEntry = { domain: string; frequency: number };

function normalizeDomainKey(domain: string): string {
  return domain.toLowerCase().trim();
}

function classifyTrend(
  inBaseline: boolean,
  inCurrent: boolean,
  delta: number | null,
): VelocityTrend {
  if (!inBaseline && inCurrent) return "new_entry";
  if (inBaseline && !inCurrent) return "dropped_out";
  if (delta !== null && delta > 5) return "accelerating";
  if (delta !== null && delta < -5) return "decelerating";
  return "stable";
}

function computeVelocityPercent(
  baseline: number,
  delta: number,
): number | null {
  if (baseline === 0) return null;
  return Math.round((delta / baseline) * 10000) / 100;
}

function buildDomainVelocity(
  domain: string,
  currentFrequency: number,
  baselineEntry: FrequencyEntry | undefined,
  yourDomain: string | null,
): DomainVelocity {
  const inBaseline = baselineEntry !== undefined;
  const baselineFrequency = inBaseline ? baselineEntry.frequency : null;

  const delta =
    baselineFrequency !== null ? currentFrequency - baselineFrequency : null;

  const velocityPercent =
    delta !== null && baselineFrequency !== null
      ? computeVelocityPercent(baselineFrequency, delta)
      : null;

  const trend = classifyTrend(inBaseline, true, delta);

  return {
    domain,
    baselineFrequency,
    currentFrequency,
    deltaFrequency: delta,
    velocityPercent,
    trend,
    isYourDomain:
      yourDomain !== null &&
      normalizeDomainKey(domain) === normalizeDomainKey(yourDomain),
  };
}

function buildDroppedOutEntry(
  baselineEntry: FrequencyEntry,
  yourDomain: string | null,
): DomainVelocity {
  const delta = -baselineEntry.frequency;
  const velocityPercent =
    baselineEntry.frequency > 0
      ? Math.round((delta / baselineEntry.frequency) * 10000) / 100
      : null;

  return {
    domain: baselineEntry.domain,
    baselineFrequency: baselineEntry.frequency,
    currentFrequency: 0,
    deltaFrequency: delta,
    velocityPercent,
    trend: "dropped_out",
    isYourDomain:
      yourDomain !== null &&
      normalizeDomainKey(baselineEntry.domain) ===
        normalizeDomainKey(yourDomain),
  };
}

function findBiggestGainer(domains: DomainVelocity[]): DomainVelocity | null {
  let best: DomainVelocity | null = null;
  for (const d of domains) {
    if (d.deltaFrequency === null) continue;
    if (d.deltaFrequency <= 0) continue;
    if (best === null || d.deltaFrequency > (best.deltaFrequency ?? 0)) {
      best = d;
    }
  }
  return best;
}

function findBiggestLoser(domains: DomainVelocity[]): DomainVelocity | null {
  let worst: DomainVelocity | null = null;
  for (const d of domains) {
    if (d.deltaFrequency === null) continue;
    if (d.deltaFrequency >= 0) continue;
    if (worst === null || d.deltaFrequency < (worst.deltaFrequency ?? 0)) {
      worst = d;
    }
  }
  return worst;
}

export function computeCitationVelocity({
  baseline,
  current,
  yourDomain,
  snapshotInterval,
}: {
  baseline: FrequencyEntry[];
  current: FrequencyEntry[];
  yourDomain?: string;
  snapshotInterval?: string;
}): CitationVelocityResponse {
  const dataIssues: string[] = [];
  const normalizedYourDomain = yourDomain?.toLowerCase().trim() ?? null;

  // Build baseline lookup map (case-insensitive)
  const baselineMap = new Map<string, FrequencyEntry>();
  for (const entry of baseline) {
    baselineMap.set(normalizeDomainKey(entry.domain), entry);
  }

  // Build current lookup set for dropped-out detection
  const currentKeys = new Set<string>(
    current.map((e) => normalizeDomainKey(e.domain)),
  );

  const velocities: DomainVelocity[] = [];

  // Process entries present in current
  for (const entry of current) {
    const key = normalizeDomainKey(entry.domain);
    const baselineEntry = baselineMap.get(key);
    velocities.push(
      buildDomainVelocity(
        entry.domain,
        entry.frequency,
        baselineEntry,
        normalizedYourDomain,
      ),
    );
  }

  // Add dropped-out domains (in baseline but not in current)
  for (const entry of baseline) {
    const key = normalizeDomainKey(entry.domain);
    if (!currentKeys.has(key)) {
      velocities.push(buildDroppedOutEntry(entry, normalizedYourDomain));
    }
  }

  // Sort by absolute delta descending (biggest movers first), nulls last
  velocities.sort((a, b) => {
    const absA = a.deltaFrequency !== null ? Math.abs(a.deltaFrequency) : -1;
    const absB = b.deltaFrequency !== null ? Math.abs(b.deltaFrequency) : -1;
    return absB - absA;
  });

  // Market leader: highest currentFrequency across non-dropped-out entries
  let marketLeader: string | null = null;
  let maxFreq = -1;
  for (const d of velocities) {
    if (d.trend !== "dropped_out" && d.currentFrequency > maxFreq) {
      maxFreq = d.currentFrequency;
      marketLeader = d.domain;
    }
  }

  const yourDomainVelocity =
    normalizedYourDomain !== null
      ? (velocities.find((d) => d.isYourDomain) ?? null)
      : null;

  return {
    source: "computed",
    yourDomain: normalizedYourDomain,
    snapshotInterval: snapshotInterval ?? null,
    dataIssues,
    domains: velocities,
    yourDomainVelocity,
    marketLeader,
    biggestGainer: findBiggestGainer(velocities),
    biggestLoser: findBiggestLoser(velocities),
  };
}
