import type {
  CapabilityKey,
  CapabilityMeta,
  NewSignal,
} from "@/server/db/schema";

const ABSOLUTE_DELTA_THRESHOLD = 10;
const PERCENT_CHANGE_THRESHOLD = 15;

export function buildScoreDeltaSignal(params: {
  userId: string;
  entityId: string;
  capabilityKey: CapabilityKey;
  meta: CapabilityMeta;
  currentScore: number;
  previousScore: number;
  runId: string;
  entityDomain: string;
}): NewSignal | null {
  const {
    userId,
    entityId,
    capabilityKey,
    meta,
    currentScore,
    previousScore,
    runId,
    entityDomain,
  } = params;

  if (!meta.primaryScoreField) return null;
  if (!meta.scoreDirection) return null;

  const absoluteDelta = Math.abs(currentScore - previousScore);
  const percentChange =
    previousScore > 0 ? (absoluteDelta / previousScore) * 100 : 0;

  const meetsThreshold =
    absoluteDelta >= ABSOLUTE_DELTA_THRESHOLD ||
    (previousScore > 0 && percentChange >= PERCENT_CHANGE_THRESHOLD);

  if (!meetsThreshold) {
    return null;
  }

  const isBadChange =
    meta.scoreDirection === "higher_is_better"
      ? currentScore < previousScore
      : currentScore > previousScore;

  if (!isBadChange) {
    return null;
  }

  const direction = currentScore < previousScore ? "dropped" : "rose";
  const pctSuffix = previousScore > 0 ? ` (${percentChange.toFixed(1)}%)` : "";

  return {
    userId,
    subjectEntityId: entityId,
    capabilityKey,
    severity: "p2",
    title: `${entityDomain}: ${meta.label} score ${direction} ${formatScore(absoluteDelta)}${pctSuffix} (${formatScore(previousScore)} → ${formatScore(currentScore)})`,
    summary: `${meta.label} changed by ${formatScore(absoluteDelta)} points${pctSuffix}.`,
    evidence: {
      sourceUrl: `https://${entityDomain}`,
      runId,
      details: {
        previousScore,
        currentScore,
        absoluteDelta,
        percentChange,
        scoreDirection: meta.scoreDirection,
        primaryScoreField: meta.primaryScoreField,
      },
    },
    confidence: "0.75",
    dedupKey: `score_delta:${capabilityKey}:${entityId}`,
  };
}

export function buildBaselineSignal(params: {
  userId: string;
  entityId: string;
  capabilityKey: CapabilityKey;
  meta: CapabilityMeta;
  currentScore: number;
  runId: string;
  entityDomain: string;
}): NewSignal | null {
  const {
    userId,
    entityId,
    capabilityKey,
    meta,
    currentScore,
    runId,
    entityDomain,
  } = params;
  if (!meta.primaryScoreField) return null;

  return {
    userId,
    subjectEntityId: entityId,
    capabilityKey,
    severity: "p3",
    title: `${entityDomain}: ${meta.label} baseline — ${formatScore(currentScore)}`,
    summary: `First measurement recorded for ${meta.label}.`,
    evidence: {
      sourceUrl: `https://${entityDomain}`,
      runId,
      details: {
        currentScore,
        primaryScoreField: meta.primaryScoreField,
      },
    },
    confidence: "0.75",
    dedupKey: `baseline:${capabilityKey}:${entityId}`,
  };
}

function formatScore(value: number): string {
  if (Number.isInteger(value)) {
    return value.toLocaleString();
  }
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
