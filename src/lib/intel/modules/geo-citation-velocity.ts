import { computeCitationVelocity } from "@/lib/intel/citation-velocity";
import { resolveCitationSources } from "@/lib/intel/geo/resolve-citation-sources";
import { unwrapSnapshotPayload } from "@/lib/intel/provenance";
import { signalSnapshotRepo } from "@/server/db/repos/signal-snapshot.repo";
import type { ModuleRunner } from "../dispatcher";
import { asOutput, requireEnv } from "./module-helpers";

type PriorDomainVelocity = { domain: string; currentFrequency: number };

// Derive the baseline from the previous day's own snapshot (its per-domain
// currentFrequency) — not a static payload field hard-coded to 0, which made
// every delta/velocityPercent meaningless. First run → no prior → empty
// baseline → all domains classified as new_entry (acceptable bootstrap).
function baselineFromPrior(
  prior: Awaited<ReturnType<typeof signalSnapshotRepo.findPrevious>>,
) {
  const payload = prior ? unwrapSnapshotPayload(prior.payload) : null;
  const domains = (payload as { domains?: unknown } | null)?.domains;
  if (!Array.isArray(domains)) return [];
  return (domains as PriorDomainVelocity[]).map((d) => ({
    domain: d.domain,
    frequency: d.currentFrequency,
  }));
}

export const runGeoCitationVelocity: ModuleRunner = async ({
  userId,
  entity,
}) => {
  const todayDate = new Date().toISOString().slice(0, 10);
  const apiKey = requireEnv("OPENROUTER_API_KEY", "geo_citation_velocity");

  const [citationResolution, prior] = await Promise.all([
    resolveCitationSources({
      userId,
      entity,
      today: todayDate,
      apiKey,
    }),
    signalSnapshotRepo.findPrevious(
      entity.id,
      "geo_citation_velocity",
      todayDate,
    ),
  ]);

  const current = citationResolution.sources.topDomains.map((domain) => ({
    domain: domain.domain,
    frequency: domain.frequency,
  }));
  const output = computeCitationVelocity({
    baseline: baselineFromPrior(prior),
    current,
    yourDomain: entity.domain,
    snapshotInterval: "day_over_day",
  });

  return {
    output: asOutput(output),
    signals: [],
    costUnits: citationResolution.costUnits,
    snapshotProvenance: { derivedFrom: citationResolution.derivedFrom },
  };
};
