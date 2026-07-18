// Public surface for the signal catalog.
//
// Source of truth: `signal-catalog.md` (human-edited, reviewed in PRs).
// Build step: `bun run signals:gen` parses the .md and writes
// `signal-catalog.generated.ts` — the .ts is what runtime imports.
//
// CI runs `bun run signals:check` to fail on drift between .md and .generated.ts.

import type { CapabilityKey, SignalCategory } from "@/server/db/schema";

export type RunFrequency =
  | "daily"
  | "weekly"
  | "biweekly"
  | "monthly"
  | "on-demand";
export type ImportanceToRevenue = "high" | "medium" | "low" | "unknown";

export interface SignalSpec {
  /** Matches runtime CAPABILITY_KEYS — single source of truth for joins. */
  capabilityKey: CapabilityKey;
  /** Human-readable name (mirrors CAPABILITY_META.label). */
  name: string;
  /** One-line plain-English summary. */
  description: string;
  /** Mirrors CAPABILITY_META.category. */
  category: SignalCategory;
  /** Primary upstream provider + endpoint/actor, comma-separated when multiple. */
  source: string;
  /** Estimated USD per run (best-effort; real numbers tracked in api_usage_events). */
  costPerCallUsd: number;
  /** Short note describing how the cost number was derived. */
  costNote: string;
  /**
   * Sibling capabilities that share an upstream API call with this one.
   * Empty array = signal runs in isolation.
   * Used by the dashboard to group "1 API call → N signals" entries so cost
   * isn't double-counted in the breakdown.
   */
  groupedWith: CapabilityKey[];
  /**
   * Upstream capabilities whose snapshots or probe artifacts this signal reads
   * before running. Empty = standalone producer. Used for scheduler ordering
   * and relational context assembly.
   */
  dependsOn: CapabilityKey[];
  /** How often the runtime enqueues this signal. */
  runFrequency: RunFrequency;
  /** True when the result is persisted to signal_snapshots and reused within
   *  the run window. */
  cached: boolean;
  /** Default baked into the .md. Live per-capability overrides land in the
   *  `signal_overrides` table via /admin/signals. */
  importanceToRevenue: ImportanceToRevenue;
}

export { SIGNAL_CATALOG } from "./signal-catalog.generated";

import { SIGNAL_CATALOG } from "./signal-catalog.generated";

/**
 * Look up a signal spec by capability key. Returns undefined when the key
 * isn't in the catalog (treat as a CI failure — every runtime capability
 * should have a catalog row, enforced by `bun run signals:check`).
 */
export function getSignalSpec(key: CapabilityKey): SignalSpec | undefined {
  return SIGNAL_CATALOG.find((s) => s.capabilityKey === key);
}

/** Direct upstream capabilities that should run before `key` (catalog-derived). */
export function getSignalDependsOn(key: CapabilityKey): CapabilityKey[] {
  return getSignalSpec(key)?.dependsOn ?? [];
}
