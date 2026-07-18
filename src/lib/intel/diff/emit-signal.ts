import type {
  NewSignal,
  SignalEvidence,
  SignalSeverity,
} from "@/server/db/schema";
import type { DiffSignalDetails, EmitDiffSignalParams } from "./types";

const CHANGE_SEVERITIES = new Set<SignalSeverity>(["p0", "p1", "p2"]);

function normalizeDiffDetails(
  severity: SignalSeverity,
  details: DiffSignalDetails | undefined,
): DiffSignalDetails | undefined {
  const isChangeSeverity = CHANGE_SEVERITIES.has(severity);
  if (!(details || isChangeSeverity)) return details;

  const normalized: DiffSignalDetails = { ...details };
  if (normalized.baseline === true) {
    delete normalized.change;
    return normalized;
  }
  if (isChangeSeverity) {
    normalized.change = true;
  }
  return normalized;
}

/**
 * True when any emitted signal represents a real change (not a baseline anchor).
 * Used by the runner to skip duplicate score-delta on the same run.
 */
export function hasChangeSignals(signals: NewSignal[]): boolean {
  return signals.some((signal) => isChangeSignal(signal));
}

function isChangeSignal(signal: NewSignal): boolean {
  const details = signal.evidence?.details as DiffSignalDetails | undefined;
  if (details?.change === true) return true;
  if (details?.baseline === true) return false;
  const severity = signal.severity;
  return severity != null && CHANGE_SEVERITIES.has(severity);
}

/**
 * Build a `NewSignal` from a diff result plus metadata, centralizing the
 * repeated `signals.push({...})` shape used across the diff modules. Handles
 * both baseline (p3) and change (p2/p1) signals; the caller supplies severity,
 * title, summary, confidence and evidence fields.
 *
 * Baseline signals should set `details.baseline = true`; change alerts at
 * p0–p2 get `details.change = true` automatically unless marked baseline.
 *
 * Evidence keys are added only when defined so the persisted `evidence` object
 * matches what the modules built by hand (baseline signals carry `afterHash`
 * but no `beforeHash`; sitemap signals carry neither).
 */
export function emitDiffSignal(params: EmitDiffSignalParams): NewSignal {
  const evidence: SignalEvidence = { runId: params.runId };
  if (params.sourceUrl !== undefined) evidence.sourceUrl = params.sourceUrl;
  if (params.beforeHash !== undefined) evidence.beforeHash = params.beforeHash;
  if (params.afterHash !== undefined) evidence.afterHash = params.afterHash;
  const details = normalizeDiffDetails(params.severity, params.details);
  if (details !== undefined) evidence.details = details;

  return {
    userId: params.userId,
    subjectEntityId: params.entityId,
    capabilityKey: params.capabilityKey,
    severity: params.severity,
    title: params.title,
    summary: params.summary ?? undefined,
    evidence,
    confidence: params.confidence ?? "0.75",
    dedupKey: params.dedupKey,
  };
}
