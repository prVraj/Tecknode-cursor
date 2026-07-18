"use client";

import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { type MockSignal, type TrendPoint } from "@/lib/mock-dashboard-data";

interface SignalTrendCardProps {
  trend: TrendPoint[];
  signals: MockSignal[];
}

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { value: number }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-xs">
      <p className="text-neutral-400">{label}</p>
      <p className="font-medium text-neutral-100">{payload[0].value} signals</p>
    </div>
  );
}

export function SignalTrendCard({ trend, signals }: SignalTrendCardProps) {
  const total = trend.reduce((sum, point) => sum + point.count, 0);
  const highSeverityCount = signals.filter((s) => s.severity === "p0" || s.severity === "p1").length;
  const otherCount = signals.length - highSeverityCount;
  const highPct = signals.length > 0 ? Math.round((highSeverityCount / signals.length) * 100) : 0;

  return (
    <div className="p-5 bg-neutral-900 rounded-2xl border border-neutral-800 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1">
          <span className="text-neutral-400 text-sm">Signals Detected</span>
          <span className="text-neutral-100 text-3xl font-semibold leading-8">{total}</span>
        </div>
        <div className="px-3 py-1.5 rounded-lg bg-neutral-800 border border-neutral-700 text-xs text-neutral-300">
          Last 14 days
        </div>
      </div>

      <div className="h-48 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={trend} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
            <defs>
              <linearGradient id="signalTrendFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#60a5fa" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#60a5fa" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="date"
              tick={{ fill: "#737373", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              interval={2}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ stroke: "#404040", strokeDasharray: 4 }} />
            <Area
              type="monotone"
              dataKey="count"
              stroke="#60a5fa"
              strokeWidth={2}
              fill="url(#signalTrendFill)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="flex items-center gap-1 h-2 rounded-full overflow-hidden">
        <div
          className="bg-red-500 h-full"
          style={{ width: `${highPct}%` }}
        />
        <div className="bg-neutral-700 h-full flex-1" />
      </div>
      <div className="flex items-center gap-4 text-xs">
        <span className="flex items-center gap-1.5 text-neutral-400">
          <span className="size-2 rounded-full bg-red-500" />
          Critical/High ({highSeverityCount})
        </span>
        <span className="flex items-center gap-1.5 text-neutral-400">
          <span className="size-2 rounded-full bg-neutral-600" />
          Medium/Low ({otherCount})
        </span>
      </div>
    </div>
  );
}
