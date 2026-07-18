import { z } from "zod";
import type { CapabilityKey } from "@/server/db/models/intel.model";
import type { DATA_ISSUE_CODES, StoredDataIssue } from "./connector-output";
import type { ModuleRunResult } from "./dispatcher";

/**
 * Soft-fail Zod validation for module outputs before snapshot persist.
 *
 * Unregistered capabilities pass through unchanged. On schema mismatch we
 * append an INTERNAL dataIssue so hasDataIssues skips score/delta writes,
 * while still persisting the raw output for debugging.
 */

const scoreNumber = z.number().finite().nullable().optional();

/** Shared envelope fields many modules already emit. */
const envelopeFields = {
  dataIssues: z
    .array(z.union([z.string(), z.record(z.string(), z.unknown())]))
    .optional(),
  partialSources: z.array(z.string()).optional(),
  skipped: z.boolean().optional(),
  skipReason: z.string().optional(),
};

const seoRankSchema = z
  .object({
    seo: z
      .object({
        yourRank: z.number().finite().nullable().optional(),
      })
      .passthrough()
      .optional(),
    ...envelopeFields,
  })
  .passthrough();

const geoVisibilitySchema = z
  .object({
    source: z.literal("computed"),
    domain: z.string().min(1),
    score: z.number().finite(),
    grade: z.enum(["A", "B", "C", "D", "F"]),
    ...envelopeFields,
  })
  .passthrough();

const geoMentionsSchema = z
  .object({
    source: z.literal("openrouter"),
    brand: z.string().min(1),
    summary: z
      .object({
        totalQueries: z.number().finite(),
        mentionedIn: z.number().finite(),
        mentionRate: z.number().finite(),
      })
      .passthrough(),
    results: z.array(z.unknown()),
    ...envelopeFields,
  })
  .passthrough();

const geoCitationsSchema = z
  .object({
    yourDomainStats: z
      .object({
        frequency: z.number().finite(),
      })
      .passthrough()
      .nullable()
      .optional(),
    ...envelopeFields,
  })
  .passthrough();

const seoCwvSchema = z
  .object({
    results: z
      .array(
        z
          .object({
            lab: z
              .object({
                performanceScore: scoreNumber,
              })
              .passthrough()
              .optional(),
          })
          .passthrough(),
      )
      .optional(),
    ...envelopeFields,
  })
  .passthrough();

/**
 * Partial registry — capabilities without an entry are not validated yet.
 * Expand as modules stabilize their output contracts.
 */
export const OUTPUT_SCHEMAS: Partial<Record<CapabilityKey, z.ZodTypeAny>> = {
  seo_rank: seoRankSchema,
  geo_visibility_score: geoVisibilitySchema,
  geo_mentions: geoMentionsSchema,
  geo_citations: geoCitationsSchema,
  seo_cwv: seoCwvSchema,
};

export type ValidateModuleOutputResult = {
  result: ModuleRunResult;
  validationFailed: boolean;
  issues: string[];
};

function appendDataIssue(
  output: Record<string, unknown>,
  detail: string,
): Record<string, unknown> {
  const existing = Array.isArray(output.dataIssues)
    ? ([...output.dataIssues] as StoredDataIssue[])
    : [];
  existing.push({
    code: "INTERNAL" satisfies (typeof DATA_ISSUE_CODES)[number],
    detail,
  });
  return { ...output, dataIssues: existing };
}

/**
 * Validate module output against the capability schema when one is registered.
 * Soft-fails: never throws; stamps dataIssues on mismatch.
 */
export function validateModuleOutput(
  capabilityKey: CapabilityKey,
  result: ModuleRunResult,
): ValidateModuleOutputResult {
  const schema = OUTPUT_SCHEMAS[capabilityKey];
  if (!schema) {
    return { result, validationFailed: false, issues: [] };
  }

  const parsed = schema.safeParse(result.output);
  if (parsed.success) {
    return { result, validationFailed: false, issues: [] };
  }

  const issues = parsed.error.issues.map(
    (i) => `${i.path.join(".") || "(root)"}: ${i.message}`,
  );
  const detail = `Output schema validation failed: ${issues.slice(0, 5).join("; ")}`;

  return {
    result: {
      ...result,
      output: appendDataIssue(result.output, detail),
    },
    validationFailed: true,
    issues,
  };
}
