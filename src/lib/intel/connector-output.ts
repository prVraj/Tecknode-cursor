import { z } from "zod";
import type { CapabilityKey, CapabilityMeta } from "@/server/db/schema";
import { sanitizeDataIssueForUser } from "./connector-errors";
import type { ModuleRunResult } from "./dispatcher";

/** Structured issue codes persisted on connector output payloads. */
export const DATA_ISSUE_CODES = [
  "PROVIDER_UNAVAILABLE",
  "MISSING_DEPENDENCY",
  "ENTITY_CONFIG",
  "PARTIAL_UPSTREAM",
  "LLM_PARSE_FAILED",
  "SCORE_UNAVAILABLE",
  "PAGE_NOT_FOUND",
  "INTERNAL",
] as const;

export type DataIssueCode = (typeof DATA_ISSUE_CODES)[number];

export type StructuredDataIssue = {
  code: DataIssueCode;
  detail?: string;
};

export type StoredDataIssue = StructuredDataIssue | string;

const dataIssueCodeSchema = z.enum(DATA_ISSUE_CODES);

const structuredIssueSchema = z.object({
  code: dataIssueCodeSchema,
  detail: z.string().optional(),
});

const legacyIssueSchema = z.union([structuredIssueSchema, z.string()]);

const envelopeSchema = z
  .object({
    dataIssues: z.array(legacyIssueSchema).optional(),
    partialSources: z.array(z.string()).optional(),
    dataIssue: z.string().optional(),
    skipped: z.boolean().optional(),
    skipReason: z.string().optional(),
  })
  .passthrough();

const DATA_ISSUE_USER_MESSAGES: Record<DataIssueCode, string> = {
  PROVIDER_UNAVAILABLE:
    "Some data sources were unavailable — results may be incomplete.",
  MISSING_DEPENDENCY:
    "This signal depends on another signal that hasn't been collected yet.",
  ENTITY_CONFIG:
    "Additional entity setup is needed (competitors, keywords, or URLs).",
  PARTIAL_UPSTREAM:
    "Some upstream data sources failed — showing partial results.",
  LLM_PARSE_FAILED:
    "AI analysis returned incomplete data — showing what we could recover.",
  SCORE_UNAVAILABLE:
    "Data was collected but no score could be calculated for this signal.",
  PAGE_NOT_FOUND: "The expected page or resource could not be found.",
  INTERNAL: "Part of the data collection step failed.",
};

/** Thrown by modules / capability adapters for hard failures classified at the runner. */
export class ModuleFailure extends Error {
  readonly isModuleFailure = true as const;

  constructor(
    message: string,
    readonly issueCode?: DataIssueCode,
  ) {
    super(message);
    this.name = "ModuleFailure";
  }
}

export function describeDataIssue(code: string, _detail?: string): string {
  const parsed = dataIssueCodeSchema.safeParse(code);
  const base = parsed.success
    ? DATA_ISSUE_USER_MESSAGES[parsed.data]
    : DATA_ISSUE_USER_MESSAGES.INTERNAL;
  return base;
}

/** Format a stored issue entry (structured or legacy string) for user UI. */
export function formatDataIssueForUser(issue: StoredDataIssue): string {
  if (typeof issue === "string") {
    return sanitizeDataIssueForUser(issue);
  }
  return describeDataIssue(issue.code, issue.detail);
}

function extractDotPath(
  obj: Record<string, unknown>,
  path: string | null,
): number | null {
  if (!path) return null;
  let val: unknown = obj;
  for (const part of path.split(".")) {
    if (val == null || typeof val !== "object") return null;
    val = (val as Record<string, unknown>)[part];
  }
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    const n = Number.parseFloat(val);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

function normalizeLegacyStringIssue(raw: string): StoredDataIssue {
  const lower = raw.toLowerCase();
  if (/run .+ first/i.test(raw)) {
    return { code: "MISSING_DEPENDENCY", detail: raw };
  }
  if (
    /not a competitor|no competitors|no social handles|not configured/i.test(
      lower,
    )
  ) {
    return { code: "ENTITY_CONFIG", detail: raw };
  }
  if (/no trust|no .* page found|could not fetch page html/i.test(lower)) {
    return { code: "PAGE_NOT_FOUND", detail: raw };
  }
  if (
    /dataforseo|apify|firecrawl|openrouter|fetch failed|unauthorized|rate limit|402|429/i.test(
      lower,
    )
  ) {
    return { code: "PROVIDER_UNAVAILABLE", detail: raw };
  }
  if (/llm|parse|json|schema/i.test(lower)) {
    return { code: "LLM_PARSE_FAILED", detail: raw };
  }
  return raw;
}

function issueKey(issue: StoredDataIssue): string {
  if (typeof issue === "string") return `legacy:${issue}`;
  return `${issue.code}:${issue.detail ?? ""}`;
}

function mergeIssues(existing: StoredDataIssue[]): StoredDataIssue[] {
  const seen = new Set<string>();
  const merged: StoredDataIssue[] = [];
  for (const issue of existing) {
    const normalized =
      typeof issue === "string" ? normalizeLegacyStringIssue(issue) : issue;
    const key = issueKey(normalized);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(normalized);
  }
  return merged;
}

export function hasStoredDataIssues(output: Record<string, unknown>): boolean {
  const issues = output.dataIssues;
  return Array.isArray(issues) && issues.length > 0;
}

function collectEnvelopeIssues(
  parsed: z.infer<typeof envelopeSchema>,
): StoredDataIssue[] {
  const issues: StoredDataIssue[] = [];
  for (const issue of parsed.dataIssues ?? []) {
    issues.push(
      typeof issue === "string" ? normalizeLegacyStringIssue(issue) : issue,
    );
  }
  if (parsed.dataIssue?.trim()) {
    issues.push(normalizeLegacyStringIssue(parsed.dataIssue.trim()));
  }
  const partialSources = parsed.partialSources ?? [];
  if (partialSources.length > 0) {
    issues.push({
      code: "PARTIAL_UPSTREAM",
      detail: `${partialSources.length} upstream source(s) failed`,
    });
  }
  return issues;
}

function collectRawOutputIssues(
  output: Record<string, unknown>,
): StoredDataIssue[] {
  const issues: StoredDataIssue[] = [];

  const dataIssues = output.dataIssues;
  if (Array.isArray(dataIssues)) {
    for (const entry of dataIssues) {
      if (typeof entry === "string") {
        issues.push(normalizeLegacyStringIssue(entry));
        continue;
      }
      if (entry == null || typeof entry !== "object") continue;

      const obj = entry as Record<string, unknown>;
      const codeParsed = dataIssueCodeSchema.safeParse(obj.code);
      if (codeParsed.success) {
        issues.push({
          code: codeParsed.data,
          detail: typeof obj.detail === "string" ? obj.detail : undefined,
        });
        continue;
      }
      if (typeof obj.code === "string") {
        issues.push(normalizeLegacyStringIssue(obj.code));
      }
    }
  }

  const dataIssue = output.dataIssue;
  if (typeof dataIssue === "string" && dataIssue.trim()) {
    issues.push(normalizeLegacyStringIssue(dataIssue.trim()));
  }

  const partialSources = output.partialSources;
  if (
    Array.isArray(partialSources) &&
    partialSources.length > 0 &&
    partialSources.every((source) => typeof source === "string")
  ) {
    issues.push({
      code: "PARTIAL_UPSTREAM",
      detail: `${partialSources.length} upstream source(s) failed`,
    });
  }

  return issues;
}

function maybeScoreUnavailableIssue(
  base: Record<string, unknown>,
  meta: CapabilityMeta | null,
): StoredDataIssue | null {
  if (base.skipped === true || !meta?.primaryScoreField) return null;
  const primaryScore = extractDotPath(base, meta.primaryScoreField);
  if (primaryScore != null || meta.primaryScoreField.length === 0) return null;
  return { code: "SCORE_UNAVAILABLE" };
}

/**
 * Normalise module output before persisting: merge partial-source failures,
 * classify legacy strings, and flag missing primary scores.
 */
export function finalizeConnectorOutput(params: {
  capabilityKey: CapabilityKey;
  result: ModuleRunResult;
  meta: CapabilityMeta | null;
}): ModuleRunResult {
  const { result, meta } = params;
  const parsed = envelopeSchema.safeParse(result.output);
  const base = parsed.success
    ? (parsed.data as Record<string, unknown>)
    : { ...result.output };

  const issues: StoredDataIssue[] = parsed.success
    ? collectEnvelopeIssues(parsed.data)
    : collectRawOutputIssues(result.output);

  const scoreIssue = maybeScoreUnavailableIssue(base, meta);
  if (scoreIssue) issues.push(scoreIssue);

  const dataIssues = mergeIssues(issues);
  const output: Record<string, unknown> = {
    ...base,
    dataIssues,
  };

  return { ...result, output };
}
