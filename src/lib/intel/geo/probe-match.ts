import { type GeoProbeWave, waveTasks } from "@/lib/intel/geo/probe-config";
import type { GeoProbeRaw, GeoProbeResult } from "@/lib/intel/geo/probe-types";

/**
 * A probe row is only usable if the call actually succeeded. A failed fetch is
 * still persisted (empty text + `dataIssue`) so the failure stays visible, but
 * treating it as a cache hit would let one upstream 429 zero out every derived
 * capability for the rest of the UTC day — the probe is date-bucketed, so the
 * retry hits the same dead row. Unusable ⇒ the consumer re-fetches live.
 */
export function isProbeResultUsable(result: GeoProbeResult): boolean {
  return !result.dataIssue && result.responseText.trim().length > 0;
}

/**
 * The wave a row belongs to. v1 blobs predate the search wave and were always
 * citation-only, so an untagged row is a citation row. Defaulting here (rather
 * than only in `normalizeGeoProbeRaw`) keeps every matcher correct even when a
 * caller hands us a raw, un-normalized blob.
 */
function rowWave(row: GeoProbeResult): GeoProbeWave {
  return row.wave ?? "citation";
}

/**
 * Find the row for an exact (wave, model, prompt) task.
 *
 * Matching is exact on purpose. Reuse is only sound when the stored response
 * was produced under the same config the caller would have used itself, so a
 * near-miss must be a miss (→ live fetch), never a silent substitution of a
 * differently-measured response.
 */
export function findProbeResult(
  results: GeoProbeResult[],
  task: { wave: GeoProbeWave; model: string; prompt: string },
): GeoProbeResult | undefined {
  return results.find(
    (row) =>
      rowWave(row) === task.wave &&
      row.model === task.model &&
      row.prompt === task.prompt,
  );
}

/** The usable row for a task, or undefined if absent or failed. */
export function findUsableProbeResult(
  results: GeoProbeResult[],
  task: { wave: GeoProbeWave; model: string; prompt: string },
): GeoProbeResult | undefined {
  const row = findProbeResult(results, task);
  return row && isProbeResultUsable(row) ? row : undefined;
}

/** Rows belonging to one wave. Parsers must filter, or the waves contaminate. */
export function waveResults(
  results: GeoProbeResult[],
  wave: GeoProbeWave,
): GeoProbeResult[] {
  return results.filter((row) => rowWave(row) === wave);
}

/**
 * True when the probe holds a usable row for *every* task in a wave — i.e. the
 * consumer will make no live calls at all.
 *
 * Callers use this to report provenance they actually observed rather than
 * provenance the catalog predicts: a module that fell back to live fetches did
 * not derive from the probe, and saying otherwise would point an analyst at a
 * producer run that had nothing to do with the number.
 */
export function probeCoversWave(
  probeRaw: GeoProbeRaw | undefined,
  wave: GeoProbeWave,
  prompts: string[],
): boolean {
  if (!probeRaw) return false;
  const tasks = waveTasks(wave, prompts);
  if (tasks.length === 0) return false;
  return tasks.every((task) =>
    findUsableProbeResult(probeRaw.results, {
      wave: task.wave,
      model: task.platform.model,
      prompt: task.prompt,
    }),
  );
}
