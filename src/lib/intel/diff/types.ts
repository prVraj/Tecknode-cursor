import type {
  CapabilityKey,
  SignalEvidence,
  SignalSeverity,
} from "@/server/db/schema";

/** Result of a content-hash diff (single blob of text, e.g. a page body). */
export interface DiffHashResult {
  /** True when a prior hash existed and differs from the current one. */
  changed: boolean;
  /** The prior hash, if one was supplied. */
  beforeHash?: string;
  /** The current hash. */
  afterHash: string;
}

/** Result of a set diff (e.g. sitemap URL sets). */
export interface DiffSetResult {
  /** Members present in `next` but not `prev` — iterated in `next` order. */
  added: string[];
  /** Members present in `prev` but not `next` — iterated in `prev` order. */
  removed: string[];
}

/** A single record that changed between two runs (record-by-id diff). */
export interface ChangedRecord<T> {
  before: T;
  after: T;
}

/** Result of a keyed record diff (e.g. ad creatives keyed by id). */
export interface DiffRecordResult<T> {
  /** Records in `next` whose key is absent from `prev` — `next` order. */
  added: T[];
  /** Records in `prev` whose key is absent from `next` — `prev` order. */
  removed: T[];
  /** Records present in both whose `changedFn` returned true — `next` order. */
  changed: Array<ChangedRecord<T>>;
  /** Count of records present in both that were unchanged. */
  unchangedCount: number;
}

/**
 * Flat parameters for {@link emitDiffSignal}. Mirrors the fields every diff
 * module was assembling by hand in each `signals.push({...})`.
 */
export interface EmitDiffSignalParams {
  userId: string;
  /** Tracked-entity id — the signal's `subjectEntityId`. */
  entityId: string;
  capabilityKey: CapabilityKey;
  severity: SignalSeverity;
  title: string;
  summary?: string | null;
  /** Connector-run id for the evidence. */
  runId: string;
  sourceUrl?: string;
  beforeHash?: string;
  afterHash?: string;
  details?: SignalEvidence["details"];
  /** 0.00–1.00 as a string; defaults to "0.75" to match legacy call sites. */
  confidence?: string;
  dedupKey: string;
}

/**
 * Evidence contract for diff signals — used by the runner to decide whether
 * module-emitted alerts should suppress automatic score-delta evaluation.
 *
 * - `baseline: true` — first-run / tracking anchor (p3); does NOT block delta.
 * - `change: true` — content or metric changed (p0–p2); blocks duplicate delta.
 */
export type DiffSignalDetails = {
  baseline?: boolean;
  change?: boolean;
  [key: string]: unknown;
};
