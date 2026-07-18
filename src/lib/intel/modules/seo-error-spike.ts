import { fetchSitemapIntel } from "@/lib/intel/sitemap-map";
import { probeUrlStatuses } from "@/lib/seo/probe-url-status";
import { signalSnapshotRepo } from "@/server/db/repos/signal-snapshot.repo";
import type { NewSignal } from "@/server/db/schema";
import type { ModuleRunner, ModuleRunResult } from "../dispatcher";

/**
 * seo_error_spike — broken (4xx/5xx) and redirecting (3xx) URLs across the
 * primary site's own discoverable URLs (Firecrawl map inventory), with
 * spike detection vs the prior snapshot. A page you publish in your sitemap
 * that now 404s is lost traffic + crawl budget; a jump in redirects often
 * means a migration went sideways.
 */

// Cap how many URLs we HEAD-probe per run to bound latency (fetches are free).
const MAX_PROBE = 50;
// A redirect-count jump of this many over the prior run is worth a p2.
const REDIRECT_SPIKE = 5;

export const runSeoErrorSpike: ModuleRunner = async ({
  userId,
  entity,
  run,
}) => {
  if (entity.role !== "primary") {
    return {
      output: { skipped: true, reason: "entity is not primary" },
      signals: [],
      costUnits: 0,
    };
  }

  const sitemap = await fetchSitemapIntel(entity.domain);
  const inventory = sitemap.ok ? sitemap.data.urls : [];
  if (inventory.length === 0) {
    return {
      output: {
        source: "firecrawl+http",
        brokenCount: 0,
        redirectCount: 0,
        broken: [],
        dataIssues: ["no URLs discovered for site"],
      },
      signals: [],
      costUnits: 1,
    };
  }

  const sample = inventory.slice(0, MAX_PROBE);
  const statuses = await probeUrlStatuses(sample);

  const broken = statuses
    .filter((s) => s.category === "broken")
    .map((s) => ({ url: s.url, statusCode: s.statusCode }));
  const redirects = statuses
    .filter((s) => s.category === "redirect")
    .map((s) => ({ url: s.url, finalUrl: s.finalUrl }));
  const brokenUrls = broken.map((b) => b.url);

  const prev = await signalSnapshotRepo.findLatest(
    entity.id,
    "seo_error_spike",
  );
  const prevBroken: string[] = Array.isArray(prev?.payload?.brokenUrls)
    ? (prev.payload.brokenUrls as string[])
    : [];
  const prevRedirectCount =
    typeof prev?.payload?.redirectCount === "number"
      ? (prev.payload.redirectCount as number)
      : 0;
  const newlyBroken = brokenUrls.filter((u) => !prevBroken.includes(u));

  const signals: NewSignal[] = [];
  if (!prev) {
    signals.push({
      userId,
      subjectEntityId: entity.id,
      capabilityKey: "seo_error_spike",
      severity: broken.length > 0 ? "p2" : "p3",
      title:
        broken.length > 0
          ? `${broken.length} broken URL(s) found across ${sample.length} checked`
          : `Monitoring ${sample.length} URL(s) for 404/redirect errors`,
      summary:
        broken.length > 0
          ? `Broken: ${broken
              .slice(0, 3)
              .map((b) => `${b.url} (${b.statusCode})`)
              .join(", ")}`
          : `Baseline: ${redirects.length} redirect(s), 0 broken.`,
      evidence: {
        sourceUrl: `https://${entity.domain}`,
        runId: run.id,
        details: {
          baseline: true,
          brokenCount: broken.length,
          redirectCount: redirects.length,
          broken: broken.slice(0, 10),
        },
      },
      confidence: "0.8",
      dedupKey: `seo_error_spike:${entity.id}:baseline`,
    });
  } else if (newlyBroken.length > 0) {
    signals.push({
      userId,
      subjectEntityId: entity.id,
      capabilityKey: "seo_error_spike",
      severity: "p1",
      title: `${newlyBroken.length} new broken URL(s) on ${entity.domain}`,
      summary: `Newly failing: ${newlyBroken.slice(0, 3).join(", ")}. Pages in your sitemap returning 4xx/5xx lose traffic and crawl budget.`,
      evidence: {
        sourceUrl: `https://${entity.domain}`,
        runId: run.id,
        details: {
          newlyBroken,
          broken: broken.slice(0, 10),
          brokenCount: broken.length,
        },
      },
      confidence: "0.85",
      dedupKey: `seo_error_spike:${entity.id}:broken`,
    });
  } else if (redirects.length - prevRedirectCount >= REDIRECT_SPIKE) {
    signals.push({
      userId,
      subjectEntityId: entity.id,
      capabilityKey: "seo_error_spike",
      severity: "p2",
      title: `Redirect spike on ${entity.domain}: ${prevRedirectCount}→${redirects.length}`,
      summary: `${redirects.length - prevRedirectCount} more URLs now redirect — check for a migration or link-structure change.`,
      evidence: {
        sourceUrl: `https://${entity.domain}`,
        runId: run.id,
        details: {
          redirectCount: redirects.length,
          redirects: redirects.slice(0, 10),
        },
      },
      confidence: "0.7",
      dedupKey: `seo_error_spike:${entity.id}:redirect`,
    });
  }

  const output: ModuleRunResult["output"] = {
    source: "firecrawl+http",
    checked: sample.length,
    inventoryCount: inventory.length,
    brokenCount: broken.length,
    redirectCount: redirects.length,
    broken: broken.slice(0, 20),
    brokenUrls,
    redirects: redirects.slice(0, 20),
    newlyBroken,
    dataIssues: [],
  };

  // 1 Firecrawl map credit; HEAD probes are free.
  return { output, signals, costUnits: 1 };
};
