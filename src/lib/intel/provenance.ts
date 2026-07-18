import { getCapabilityProducers } from "@/lib/intel/capability-order";
import type { CapabilityKey } from "@/server/db/schema";

export type SnapshotProvenance = {
  derivedFrom: CapabilityKey[];
  producerRunId?: string;
  sources: string[];
};

export type SnapshotPayloadEnvelope<T> = {
  data: T;
  provenance: SnapshotProvenance;
};

const ENVELOPE_DATA_KEY = "data";
const ENVELOPE_PROVENANCE_KEY = "provenance";

export function isSnapshotEnvelope(
  payload: unknown,
): payload is SnapshotPayloadEnvelope<unknown> {
  if (
    payload == null ||
    typeof payload !== "object" ||
    Array.isArray(payload)
  ) {
    return false;
  }
  const record = payload as Record<string, unknown>;
  const provenance = record[ENVELOPE_PROVENANCE_KEY];
  return (
    ENVELOPE_DATA_KEY in record &&
    provenance != null &&
    typeof provenance === "object" &&
    !Array.isArray(provenance) &&
    Array.isArray((provenance as SnapshotProvenance).derivedFrom) &&
    Array.isArray((provenance as SnapshotProvenance).sources)
  );
}

export function wrapSnapshotPayload<T>(
  data: T,
  provenance: SnapshotProvenance,
): SnapshotPayloadEnvelope<T> {
  return { data, provenance };
}

/** Accepts bare module output or a `{ data, provenance }` envelope. */
export function unwrapSnapshotPayload<T>(payload: unknown): T {
  if (isSnapshotEnvelope(payload)) {
    return payload.data as T;
  }
  return payload as T;
}

export function unwrapSnapshotProvenance(
  payload: unknown,
): SnapshotProvenance | null {
  return isSnapshotEnvelope(payload) ? payload.provenance : null;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

/** Pull upstream provider labels from module output (`source` or `sources`). */
export function extractOutputSources(
  output: Record<string, unknown>,
): string[] {
  const fromField = output.source;
  if (typeof fromField === "string" && fromField.trim()) {
    return [fromField.trim()];
  }

  const fromArray = output.sources;
  if (Array.isArray(fromArray)) {
    return uniqueStrings(
      fromArray.filter((entry): entry is string => typeof entry === "string"),
    );
  }

  return [];
}

/**
 * Build snapshot provenance for a connector run. Module overrides win over
 * catalog-derived producer edges; catalog fills gaps when the module omits
 * `derivedFrom`.
 */
export function buildSnapshotProvenance(params: {
  capabilityKey: CapabilityKey;
  output: Record<string, unknown>;
  override?: Partial<SnapshotProvenance>;
  producerRunId?: string;
}): SnapshotProvenance {
  const catalogProducers = getCapabilityProducers(params.capabilityKey);
  const derivedFrom =
    params.override?.derivedFrom !== undefined
      ? params.override.derivedFrom
      : catalogProducers;

  const outputSources = extractOutputSources(params.output);
  const sources = uniqueStrings([
    ...(params.override?.sources ?? []),
    ...outputSources,
  ]);

  return {
    derivedFrom,
    sources,
    producerRunId: params.override?.producerRunId ?? params.producerRunId,
  };
}
