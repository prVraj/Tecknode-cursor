import type { Severity, TopCapability } from "@/lib/dashboard-data";

interface TopCapabilitiesTableProps {
  capabilities: TopCapability[];
}

const SEVERITY_DOT: Record<Severity, string> = {
  p0: "bg-red-500",
  p1: "bg-blue-500",
  p2: "bg-yellow-500",
  p3: "bg-green-500",
};

const CATEGORY_LABEL: Record<TopCapability["category"], string> = {
  seo: "SEO",
  geo: "GEO",
  mentions: "Mentions",
};

export function TopCapabilitiesTable({ capabilities }: TopCapabilitiesTableProps) {
  return (
    <div className="p-5 bg-neutral-900 rounded-2xl border border-neutral-800 flex flex-col gap-4">
      <span className="text-neutral-100 text-sm font-medium">Top Capabilities</span>

      <div className="flex flex-col gap-1">
        {capabilities.map((cap, index) => (
          <div
            key={cap.capabilityLabel}
            className="flex items-center gap-3 py-2 border-b border-neutral-800 last:border-0"
          >
            <span className="text-neutral-500 text-xs font-medium w-4 shrink-0">
              {index + 1}
            </span>
            <span className={`size-1.5 rounded-full shrink-0 ${SEVERITY_DOT[cap.severity]}`} />
            <div className="flex-1 min-w-0">
              <p className="text-neutral-100 text-sm truncate">{cap.capabilityLabel}</p>
            </div>
            <span className="text-neutral-500 text-xs shrink-0 px-2 py-0.5 rounded-md bg-neutral-800 border border-neutral-700">
              {CATEGORY_LABEL[cap.category]}
            </span>
            <span className="text-neutral-100 text-sm font-medium shrink-0 w-10 text-right">
              {cap.signalCount}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
