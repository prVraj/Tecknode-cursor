import { ArrowDown, ArrowUp, type LucideIcon } from "lucide-react";
import type { StatDelta } from "@/lib/dashboard-data";

interface StatCardProps {
  label: string;
  value: string;
  icon: LucideIcon;
  delta?: StatDelta;
}

export function StatCard({ label, value, icon: Icon, delta }: StatCardProps) {
  return (
    <div className="aspect-square sm:aspect-auto sm:min-h-40 p-5 bg-neutral-900 rounded-2xl border border-neutral-800 flex flex-col justify-between gap-4">
      <div className="flex items-center justify-between">
        <div className="size-9 shrink-0 bg-neutral-800 rounded-lg border border-neutral-700 flex justify-center items-center text-neutral-100">
          <Icon size={18} />
        </div>
        {delta ? (
          <div
            className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-xs font-medium ${
              delta.direction === "up"
                ? "bg-green-950/60 text-green-400 border border-green-900/50"
                : "bg-red-950/60 text-red-400 border border-red-900/50"
            }`}
          >
            {delta.direction === "up" ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
            {delta.percent}%
          </div>
        ) : null}
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-neutral-100 text-3xl font-semibold leading-8">{value}</span>
        <span className="text-neutral-400 text-sm font-normal leading-[21px] truncate">
          {label}
        </span>
      </div>
    </div>
  );
}
