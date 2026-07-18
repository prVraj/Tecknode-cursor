import {
  computeDelta,
  computeSignalTrend,
  computeTopCapabilities,
  computeWeekdayActivity,
} from "@/lib/dashboard-data";
import { toDashboardEntity, toDashboardSignal } from "@/lib/dashboard-mappers";
import {
  getIntelSettingsAction,
  listSignalsAction,
  listTrackedEntitiesAction,
} from "@/server/actions/intel.actions";
import { CAPABILITY_KEYS } from "@/server/db/schema";
import { DashboardClient, type DashboardStats } from "./_components/dashboard-client";

const DAY_MS = 24 * 60 * 60 * 1000;

function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-10 text-center bg-neutral-950 min-h-svh">
      <h1 className="text-lg font-semibold text-neutral-100">Dashboard</h1>
      <p className="max-w-sm text-sm text-red-400">{message}</p>
    </div>
  );
}

export default async function DashboardPage() {
  const since = new Date(Date.now() - 30 * DAY_MS);

  const [entitiesRes, signalsRes, settingsRes] = await Promise.all([
    listTrackedEntitiesAction(),
    listSignalsAction({ since, limit: 200 }),
    getIntelSettingsAction(),
  ]);

  if ("error" in entitiesRes) return <ErrorState message={entitiesRes.error} />;
  if ("error" in signalsRes) return <ErrorState message={signalsRes.error} />;
  if ("error" in settingsRes) return <ErrorState message={settingsRes.error} />;

  const entities = entitiesRes.map(toDashboardEntity);
  const signals = signalsRes.map(toDashboardSignal);

  const weekAgo = Date.now() - 7 * DAY_MS;
  const twoWeeksAgo = Date.now() - 14 * DAY_MS;

  const thisWeek = signals.filter((s) => new Date(s.lastSeenAt).getTime() >= weekAgo);
  const lastWeek = signals.filter((s) => {
    const t = new Date(s.lastSeenAt).getTime();
    return t >= twoWeeksAgo && t < weekAgo;
  });

  const criticalCount = thisWeek.filter((s) => s.severity === "p0").length;
  const prevCriticalCount = lastWeek.filter((s) => s.severity === "p0").length;

  const activeCapabilities = Object.values(
    settingsRes.enabledCapabilities,
  ).filter(Boolean).length;

  const stats: DashboardStats = {
    competitorCount: entities.filter((e) => e.role === "competitor").length,
    weekSignalCount: thisWeek.length,
    activeCapabilities,
    criticalCount,
    signalsDelta: computeDelta(thisWeek.length, lastWeek.length),
    criticalDelta: computeDelta(criticalCount, prevCriticalCount),
  };

  return (
    <DashboardClient
      entities={entities}
      signals={signals}
      trend={computeSignalTrend(signals, 14)}
      weekday={computeWeekdayActivity(signals)}
      topCapabilities={computeTopCapabilities(signals, 5)}
      coverage={{ active: activeCapabilities, total: CAPABILITY_KEYS.length }}
      stats={stats}
    />
  );
}
