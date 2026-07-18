import {
  type AiMentionsResponse,
  buildAiMentionsResponse,
} from "@/lib/intel/ai-mentions";
import {
  buildCitationSourcesResponse,
  type CitationSourcesResponse,
} from "@/lib/intel/citation-sources";
import type {
  StoredDataIssue,
  StructuredDataIssue,
} from "@/lib/intel/connector-output";
import { buildVisibilityScore } from "@/lib/intel/visibility-score";
import type { CapabilityKey } from "@/server/db/schema";
import type { ModuleRunner } from "../dispatcher";
import {
  asOutput,
  getBrand,
  getCompetitorDomains,
  getPrompts,
  readTodaySnapshotPayload,
  requireEnv,
} from "./module-helpers";

/**
 * Attribute one upstream issue to the capability it came from.
 *
 * Upstream issues arrive in TWO shapes and both must survive:
 *
 *  - Recompute path: the module calls `buildCitationSourcesResponse` itself and
 *    gets raw strings.
 *  - Snapshot-reuse path (the normal one, and the reason this module exists):
 *    the payload was persisted through `finalizeConnectorOutput`, which
 *    normalises every string into a structured `{ code, detail }`.
 *
 * Interpolating the structured shape into a template yields the literal
 * "[object Object]": the reason text is destroyed and the classification (e.g.
 * PROVIDER_UNAVAILABLE) is thrown away, then re-derived by pattern-matching the
 * garbage string — which matches nothing and reaches users via
 * `formatDataIssueForUser`. So keep the code and prefix only the detail; the
 * classification round-trips exactly instead of being re-guessed from text.
 */
function prefixIssue(source: CapabilityKey, issue: unknown): StoredDataIssue {
  if (isStructuredIssue(issue)) {
    const detail = issue.detail?.trim();
    return {
      code: issue.code,
      detail: detail ? `${source}: ${detail}` : source,
    };
  }
  return `${source}: ${String(issue)}`;
}

function isStructuredIssue(value: unknown): value is StructuredDataIssue {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as StructuredDataIssue).code === "string"
  );
}

/**
 * Prefix an upstream capability's dataIssues, tolerating a stored payload that
 * predates the field (or carries a non-array in its place).
 */
function upstreamIssues(
  source: CapabilityKey,
  issues: unknown,
): StoredDataIssue[] {
  if (!Array.isArray(issues)) return [];
  return issues.map((issue) => prefixIssue(source, issue));
}

export const runGeoVisibilityScore: ModuleRunner = async ({
  userId,
  entity,
}) => {
  // geo_visibility_score derives entirely from the citation + mentions clusters
  // that geo_citations and geo_mentions already probe earlier in the daily
  // drain. Reuse their same-day snapshots and only run a builder ourselves when
  // its snapshot is missing — recompute is the never-stale fallback.
  const today = new Date().toISOString().slice(0, 10);
  let citations = await readTodaySnapshotPayload<CitationSourcesResponse>(
    entity.id,
    "geo_citations",
    today,
  );
  let mentions = await readTodaySnapshotPayload<AiMentionsResponse>(
    entity.id,
    "geo_mentions",
    today,
  );

  const reusedFrom: CapabilityKey[] = [];
  if (citations) reusedFrom.push("geo_citations");
  if (mentions) reusedFrom.push("geo_mentions");

  let costUnits = 0;
  if (!(citations && mentions)) {
    const apiKey = requireEnv("OPENROUTER_API_KEY", "geo_visibility_score");
    const competitors = await getCompetitorDomains({ userId, entity });
    const prompts = getPrompts(entity);
    if (!citations) {
      citations = await buildCitationSourcesResponse({
        prompts,
        yourDomain: entity.domain,
        competitors,
        apiKey,
      });
      costUnits += 1;
    }
    if (!mentions) {
      mentions = await buildAiMentionsResponse({
        brand: getBrand(entity),
        competitors,
        prompts,
        apiKey,
      });
      costUnits += 1;
    }
  }

  // Same reason as `upstreamIssues`: these come from a type-asserted snapshot,
  // so `results`/`summary` may be absent on a stored row that predates them.
  // Reading them raw throws and takes the run down.
  const results = Array.isArray(mentions.results) ? mentions.results : [];
  const summary = mentions.summary ?? ({} as (typeof mentions)["summary"]);

  const recommended = results.filter(
    (result) => result?.yourBrand?.mentionType === "recommended",
  ).length;
  // No results = nothing was measured, which is NOT the same as "measured, and
  // 0% were recommended". Coercing to 0 here is the same fabrication the rest of
  // this module was fixed for: it scores as a genuine zero and raises no
  // dataIssue. `undefined` lets the builder flag it.
  const recommendationRate =
    results.length > 0
      ? Math.round((recommended / results.length) * 100)
      : undefined;
  const payload = entity.payload as Record<string, unknown>;
  const previousScore =
    typeof payload.previousScore === "number" &&
    Number.isFinite(payload.previousScore)
      ? payload.previousScore
      : undefined;

  // Every field below must pass `undefined` when the upstream value is genuinely
  // ABSENT, never a stand-in. `buildVisibilityScore` raises a dataIssue for each
  // null input, and `hasStoredDataIssues` is what stops the runner emitting a
  // score-delta off degraded data. Coercing a missing input to a concrete value
  // (`?? 0`, `?? "not_found"`) silently defeats that whole chain and ships a
  // real-looking delta built on a flaked probe.
  const output = buildVisibilityScore({
    domain: entity.domain,
    previousScore,
    // `yourDomainStats: null` means our domain was absent from the citation
    // response — a flake, NOT the same fact as "present with zero citations".
    // Optional chaining yields undefined for the former and keeps a genuine 0
    // for the latter, so the two stay distinguishable.
    citationFrequency: citations.yourDomainStats?.frequency,
    mentionRate: summary.mentionRate,
    // `null` = the field is absent from the summary (missing). `"not_found"` is
    // a REAL enum value ai-mentions returns for "brand not in the answer", so it
    // must keep scoring — only the null case degrades.
    dominantSentiment: summary.dominantSentiment ?? undefined,
    avgPosition: summary.avgPosition ?? undefined,
    recommendationRate,
  });

  // A score derived from a degraded input is itself degraded. geo_citations and
  // geo_mentions each carry their own dataIssues; without propagating them, a
  // partial upstream failure that still produced all five fields would score
  // clean and emit a delta anyway.
  //
  // `?? []` is not paranoia: these payloads come from `signal_snapshots` via a
  // TYPE ASSERTION with no runtime validation, and stored rows genuinely
  // predate the current shape (seo_rank has live rows in three different
  // payload shapes). The type says `string[]`; the database does not promise
  // it. Without this, one legacy row throws
  // "Cannot read properties of undefined (reading 'map')" and takes down the
  // whole run — a crash, in the module whose entire job is to not mishandle
  // degraded input.
  const dataIssues = [
    ...upstreamIssues("geo_citations", citations.dataIssues),
    ...upstreamIssues("geo_mentions", mentions.dataIssues),
    ...output.dataIssues,
  ];

  return {
    output: asOutput({ ...output, dataIssues }),
    signals: [],
    costUnits,
    snapshotProvenance:
      reusedFrom.length > 0 ? { derivedFrom: reusedFrom } : undefined,
  };
};
