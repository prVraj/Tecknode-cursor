import { getIntelSettingsAction } from "@/server/actions/intel.actions";
import { CAPABILITY_KEYS, CAPABILITY_META } from "@/server/db/schema";
import { CapabilitySettings } from "./_components/capability-settings";

export default async function IntegrationsPage() {
  const result = await getIntelSettingsAction();

  const header = (
    <div className="flex flex-col gap-1 px-6 pt-4 pb-4 border-b border-neutral-800">
      <h1 className="text-xl font-semibold text-neutral-100">Integrations</h1>
      <p className="text-sm text-neutral-400">
        Choose which signal capabilities run for your tracked entities.
      </p>
    </div>
  );

  if ("error" in result) {
    return (
      <div className="flex flex-col bg-neutral-950 min-h-svh">
        {header}
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-10 text-center">
          <p className="text-sm text-red-400">{result.error}</p>
        </div>
      </div>
    );
  }

  const catalog = CAPABILITY_KEYS.map((key) => ({
    key,
    label: CAPABILITY_META[key].label,
    category: CAPABILITY_META[key].category,
  }));

  return (
    <div className="flex flex-col bg-neutral-950 min-h-svh">
      {header}
      <div className="p-5">
        <CapabilitySettings
          catalog={catalog}
          initialEnabled={result.enabledCapabilities}
        />
      </div>
    </div>
  );
}
