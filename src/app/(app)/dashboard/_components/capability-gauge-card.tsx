import Link from "next/link";

interface CapabilityGaugeCardProps {
  active: number;
  total: number;
}

const RADIUS = 42;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function CapabilityGaugeCard({ active, total }: CapabilityGaugeCardProps) {
  const pct = total > 0 ? Math.round((active / total) * 100) : 0;
  const offset = CIRCUMFERENCE - (pct / 100) * CIRCUMFERENCE;

  return (
    <div className="p-5 bg-neutral-900 rounded-2xl border border-neutral-800 flex flex-col gap-4">
      <span className="text-neutral-100 text-sm font-medium">Capability Coverage</span>

      <div className="relative flex items-center justify-center py-2">
        <svg width="120" height="120" viewBox="0 0 100 100" className="-rotate-90">
          <circle
            cx="50"
            cy="50"
            r={RADIUS}
            fill="none"
            stroke="#404040"
            strokeWidth="10"
          />
          <circle
            cx="50"
            cy="50"
            r={RADIUS}
            fill="none"
            stroke="#60a5fa"
            strokeWidth="10"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={offset}
            strokeLinecap="round"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-neutral-100 text-2xl font-semibold">{pct}%</span>
        </div>
      </div>

      <p className="text-neutral-400 text-xs text-center">
        {active} of {total} capabilities active
      </p>

      <Link
        href="/dashboard/tracking"
        className="w-full px-3 py-1.5 rounded-lg bg-neutral-800 border border-neutral-700 text-center text-xs text-neutral-200 hover:bg-neutral-700 transition-colors"
      >
        Show details
      </Link>
    </div>
  );
}
