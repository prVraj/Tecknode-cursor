#!/usr/bin/env bun

// Dev-only seed + smoke test for the signal engine (Phase 2). Creates a test
// user + tracked entity + user_intel_settings, then optionally drives the
// engine directly (no HTTP, no auth) so you get instant feedback.
//
// Usage:
//   bun scripts/seed-dev-intel.ts [domain]            # seed only
//   bun scripts/seed-dev-intel.ts [domain] --run       # seed + run the engine once
//
// After seeding without --run, you can also exercise the HTTP layer:
//   - Cron tick (no user login needed, just CRON_SECRET):
//       curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/intel/tick
//   - Manual refresh / run-status routes DO require a real signed-in browser
//     session (they're user-scoped), so drive those by signing up via
//     /sign-up in the browser and tracking a real domain once that UI ships.

import { drainPendingRuns, reclaimGhostRuns } from "@/lib/intel/runner";
import { enqueueDailyRuns } from "@/lib/intel/scheduler";
import { db } from "@/server/db";
import { trackedEntityRepo } from "@/server/db/repos/tracked-entity.repo";
import { userIntelSettingsRepo } from "@/server/db/repos/user-intel-settings.repo";
import { user } from "@/server/db/schema";

const DEV_USER_ID = "dev-seed-user";
const args = process.argv.slice(2);
const shouldRun = args.includes("--run");
const domain = args.find((a) => !a.startsWith("--")) ?? "example.com";

async function main() {
  await db
    .insert(user)
    .values({
      id: DEV_USER_ID,
      name: "Dev Seed User",
      email: "dev-seed@example.com",
      emailVerified: true,
    })
    .onConflictDoNothing({ target: user.id });

  const existing = await trackedEntityRepo.findByUserAndDomain(
    DEV_USER_ID,
    domain,
  );
  const entity =
    existing ??
    (await trackedEntityRepo.create({
      userId: DEV_USER_ID,
      role: "primary",
      domain,
    }));

  // Cheap, single-capability set — keeps a smoke run to one paid call instead
  // of fanning out across all 64. Swap/add keys as needed.
  await userIntelSettingsRepo.ensure(DEV_USER_ID);
  await userIntelSettingsRepo.updateEnabledCapabilities(DEV_USER_ID, {
    seo_rank: true,
  });

  console.log("✓ Seeded dev intel fixture:");
  console.log(`  userId:   ${DEV_USER_ID}`);
  console.log(`  entityId: ${entity?.id}`);
  console.log(`  domain:   ${domain}`);

  if (!shouldRun) {
    console.log("");
    console.log("Re-run with --run to drive the engine now, e.g.:");
    console.log(`  bun scripts/seed-dev-intel.ts ${domain} --run`);
    process.exit(0);
  }

  console.log("");
  console.log("Reclaiming ghost runs...");
  const reclaimed = await reclaimGhostRuns();
  console.log(`  reclaimed: ${reclaimed}`);

  console.log("Enqueuing due runs (enqueueDailyRuns, scoped to dev user)...");
  const scheduled = await enqueueDailyRuns(
    new Date(),
    crypto.randomUUID(),
    DEV_USER_ID,
  );
  console.log(JSON.stringify(scheduled, null, 2));

  console.log(
    "Draining pending runs (drainPendingRuns, scoped to dev user)...",
  );
  const drained = await drainPendingRuns({ userId: DEV_USER_ID });
  console.log(JSON.stringify(drained, null, 2));

  console.log("");
  console.log(
    drained.succeeded > 0
      ? "✓ At least one capability ran successfully — check signal_snapshots / signals tables."
      : drained.failed > 0
        ? "✗ Runs failed — check connector_runs.error_message (likely a missing provider API key, which is expected without real credentials)."
        : "No runs were due yet (cadence/backoff gate) — try a fresh domain or check connector_runs directly.",
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
