import { toDashboardEntity } from "@/lib/dashboard-mappers";
import { listTrackedEntitiesAction } from "@/server/actions/intel.actions";
import { FIRST_RUN_CAPABILITIES } from "@/server/db/schema";
import { TrackingClient } from "./_components/tracking-client";

export default async function TrackingPage() {
  const result = await listTrackedEntitiesAction();

  if ("error" in result) {
    return (
      <div className="flex flex-col bg-neutral-950 min-h-svh">
        <div className="flex items-center gap-3 px-6 pt-4 pb-4 border-b border-neutral-800">
          <h1 className="flex-1 text-xl font-semibold text-neutral-100">Tracking</h1>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-10 text-center">
          <p className="text-sm text-red-400">{result.error}</p>
        </div>
      </div>
    );
  }

  const entities = result.map(toDashboardEntity);

  return (
    <div className="flex flex-col bg-neutral-950 min-h-svh">
      <div className="flex items-center gap-3 px-6 pt-4 pb-4 border-b border-neutral-800">
        <h1 className="flex-1 text-xl font-semibold text-neutral-100">Tracking</h1>
        <div className="px-3 py-1.5 rounded-lg bg-neutral-900 border border-neutral-800 text-xs text-neutral-400 hidden sm:block">
          Manage your primary brand and competitors
        </div>
      </div>

      <div className="p-5">
        <TrackingClient
          entities={entities}
          firstRunCapabilities={[...FIRST_RUN_CAPABILITIES]}
        />
      </div>
    </div>
  );
}
