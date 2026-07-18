"use client";

import { useState, useTransition } from "react";
import { updateIntelSettingsAction } from "@/server/actions/intel.actions";
import type { CapabilityKey, EnabledCapabilities, SignalCategory } from "@/server/db/schema";

interface CatalogEntry {
  key: CapabilityKey;
  label: string;
  category: SignalCategory;
}

interface CapabilitySettingsProps {
  catalog: CatalogEntry[];
  initialEnabled: EnabledCapabilities;
}

const CATEGORY_ORDER: SignalCategory[] = ["seo", "geo", "mentions"];
const CATEGORY_LABEL: Record<SignalCategory, string> = {
  seo: "SEO",
  geo: "GEO",
  mentions: "Mentions",
};

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      disabled={disabled}
      className="relative h-5 w-9 shrink-0 rounded-full border transition-colors disabled:opacity-50"
      style={{
        backgroundColor: checked ? "#60a5fa" : "#404040",
        borderColor: checked ? "#60a5fa" : "#525252",
      }}
    >
      <span
        className="absolute top-0.5 size-3.5 rounded-full bg-white transition-transform"
        style={{ transform: checked ? "translateX(18px)" : "translateX(2px)" }}
      />
    </button>
  );
}

export function CapabilitySettings({ catalog, initialEnabled }: CapabilitySettingsProps) {
  const [enabled, setEnabled] = useState<EnabledCapabilities>(initialEnabled);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function handleToggle(key: CapabilityKey) {
    const previous = enabled;
    const next = { ...enabled, [key]: !enabled[key] };
    setEnabled(next);
    setError(null);

    startTransition(async () => {
      const result = await updateIntelSettingsAction({ enabledCapabilities: next });
      if ("error" in result) {
        setEnabled(previous);
        setError(result.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-3 max-w-3xl">
      {error ? <p className="text-sm text-red-400">{error}</p> : null}

      {CATEGORY_ORDER.map((category) => {
        const rows = catalog.filter((c) => c.category === category);
        const activeCount = rows.filter((c) => enabled[c.key]).length;

        return (
          <div
            key={category}
            className="p-5 bg-neutral-900 rounded-2xl border border-neutral-800 flex flex-col gap-3"
          >
            <div className="flex items-center justify-between">
              <span className="text-neutral-100 text-sm font-medium">
                {CATEGORY_LABEL[category]}
              </span>
              <span className="px-2 py-0.5 rounded-md bg-neutral-800 border border-neutral-700 text-xs text-neutral-400">
                {activeCount} of {rows.length} active
              </span>
            </div>

            <div className="flex flex-col">
              {rows.map((row) => (
                <div
                  key={row.key}
                  className="flex items-center gap-3 py-2 border-b border-neutral-800 last:border-0"
                >
                  <span className="flex-1 text-sm text-neutral-300">{row.label}</span>
                  <Toggle
                    checked={Boolean(enabled[row.key])}
                    onChange={() => handleToggle(row.key)}
                  />
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
