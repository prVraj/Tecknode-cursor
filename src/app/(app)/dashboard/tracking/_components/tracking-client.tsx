"use client";

import { Globe, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { DashboardEntity } from "@/lib/dashboard-data";
import { MAX_COMPETITORS } from "@/lib/dashboard-data";
import {
  addTrackedEntityAction,
  removeTrackedEntityAction,
} from "@/server/actions/intel.actions";
import type { CapabilityKey } from "@/server/db/schema";

interface TrackingClientProps {
  entities: DashboardEntity[];
  firstRunCapabilities: CapabilityKey[];
}

function triggerFirstRunSignals(entityId: string, capabilities: CapabilityKey[]) {
  for (const capabilityKey of capabilities) {
    fetch("/api/intel/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entityId, capabilityKey }),
    }).catch(() => {
      // Fire-and-forget: the tracking page doesn't block on run status.
    });
  }
}

function AddEntityForm({
  role,
  onAdded,
  onCancel,
  firstRunCapabilities,
}: {
  role: "primary" | "competitor";
  onAdded: () => void;
  onCancel: () => void;
  firstRunCapabilities: CapabilityKey[];
}) {
  const [domain, setDomain] = useState("");
  const [brandName, setBrandName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await addTrackedEntityAction({
        domain,
        brandName: brandName.trim() || undefined,
        role,
      });
      if ("error" in result) {
        setError(result.error);
        return;
      }
      triggerFirstRunSignals(result.id, firstRunCapabilities);
      setDomain("");
      setBrandName("");
      onAdded();
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="p-3 bg-neutral-950 rounded-xl border border-neutral-800 flex flex-col gap-2"
    >
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          type="text"
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          placeholder="example.com"
          className="flex-1 px-3 py-1.5 rounded-lg bg-neutral-900 border border-neutral-800 text-sm text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:border-neutral-600"
          autoFocus
        />
        <input
          type="text"
          value={brandName}
          onChange={(e) => setBrandName(e.target.value)}
          placeholder="Brand name (optional)"
          className="flex-1 px-3 py-1.5 rounded-lg bg-neutral-900 border border-neutral-800 text-sm text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:border-neutral-600"
        />
      </div>
      {error ? <p className="text-xs text-red-400">{error}</p> : null}
      <div className="flex items-center gap-2 justify-end">
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 rounded-lg text-xs text-neutral-400 hover:text-neutral-100 transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isPending || !domain.trim()}
          className="px-3 py-1.5 rounded-lg bg-neutral-100 text-neutral-900 text-xs font-medium hover:bg-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isPending ? "Adding…" : "Add"}
        </button>
      </div>
    </form>
  );
}

function EntityRow({ entity }: { entity: DashboardEntity }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleRemove() {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await removeTrackedEntityAction({ entityId: entity.id });
      if ("error" in result) {
        setError(result.error);
        setConfirming(false);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="p-3 rounded-xl bg-neutral-900 border border-neutral-800 flex items-center gap-3 hover:border-neutral-700 transition-colors">
      <div className="size-9 shrink-0 bg-neutral-800 rounded-lg border border-neutral-700 flex items-center justify-center text-neutral-100">
        <Globe size={16} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-neutral-100 truncate">
          {entity.brandName}
        </p>
        <p className="text-xs text-neutral-500 truncate">{entity.domain}</p>
        {error ? <p className="text-xs text-red-400 mt-1">{error}</p> : null}
      </div>
      <button
        type="button"
        onClick={handleRemove}
        disabled={isPending}
        className={`shrink-0 px-2 py-1.5 rounded-lg text-xs flex items-center gap-1 transition-colors disabled:opacity-50 ${
          confirming
            ? "bg-red-950/60 border border-red-900/50 text-red-400"
            : "text-neutral-500 hover:text-neutral-100 hover:bg-neutral-800"
        }`}
      >
        <Trash2 size={14} />
        {confirming ? "Confirm?" : null}
      </button>
    </div>
  );
}

export function TrackingClient({ entities, firstRunCapabilities }: TrackingClientProps) {
  const router = useRouter();
  const [showAddPrimary, setShowAddPrimary] = useState(false);
  const [showAddCompetitor, setShowAddCompetitor] = useState(false);

  const primary = entities.find((e) => e.role === "primary");
  const competitors = entities.filter((e) => e.role === "competitor");

  return (
    <div className="flex flex-col gap-5 max-w-3xl">
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-neutral-100 text-sm font-medium">Primary brand</span>
        </div>

        {primary ? (
          <EntityRow entity={primary} />
        ) : showAddPrimary ? (
          <AddEntityForm
            role="primary"
            firstRunCapabilities={firstRunCapabilities}
            onCancel={() => setShowAddPrimary(false)}
            onAdded={() => {
              setShowAddPrimary(false);
              router.refresh();
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => setShowAddPrimary(true)}
            className="w-full p-6 bg-neutral-900 rounded-2xl border border-neutral-800 flex flex-col items-center justify-center gap-2 hover:bg-neutral-800 hover:border-neutral-700 transition-colors"
          >
            <div className="size-9 bg-neutral-800 rounded-lg flex items-center justify-center">
              <Plus size={16} className="text-neutral-100" />
            </div>
            <p className="text-sm text-neutral-300">Add your brand to start tracking</p>
          </button>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-neutral-100 text-sm font-medium">Competitors</span>
          <span className="px-2 py-0.5 rounded-md bg-neutral-800 border border-neutral-700 text-xs text-neutral-400">
            {competitors.length}/{MAX_COMPETITORS}
          </span>
        </div>

        <div className="flex flex-col gap-2">
          {competitors.map((entity) => (
            <EntityRow key={entity.id} entity={entity} />
          ))}
        </div>

        {showAddCompetitor ? (
          <AddEntityForm
            role="competitor"
            firstRunCapabilities={firstRunCapabilities}
            onCancel={() => setShowAddCompetitor(false)}
            onAdded={() => {
              setShowAddCompetitor(false);
              router.refresh();
            }}
          />
        ) : competitors.length < MAX_COMPETITORS ? (
          <button
            type="button"
            onClick={() => setShowAddCompetitor(true)}
            className="w-full p-3 bg-neutral-900 rounded-xl border border-neutral-800 flex items-center justify-center gap-2 text-sm text-neutral-300 hover:bg-neutral-800 hover:border-neutral-700 transition-colors"
          >
            <Plus size={14} />
            Add competitor
          </button>
        ) : (
          <p className="text-xs text-neutral-500 text-center py-2">
            Competitor limit reached
          </p>
        )}
      </section>
    </div>
  );
}
