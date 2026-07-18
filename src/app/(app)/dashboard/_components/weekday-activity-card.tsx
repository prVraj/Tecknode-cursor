"use client";

import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import type { WeekdayActivity } from "@/lib/dashboard-data";

interface WeekdayActivityCardProps {
  data: WeekdayActivity[];
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

export function WeekdayActivityCard({ data }: WeekdayActivityCardProps) {
  const peak = Math.max(...data.map((d) => d.count));

  return (
    <div className="p-5 bg-neutral-900 rounded-2xl border border-neutral-800 flex flex-col gap-4">
      <span className="text-neutral-100 text-sm font-medium">Most Active Day</span>
      <div className="h-32 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
            <XAxis
              dataKey="day"
              tick={{ fill: "#737373", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: "#262626" }} />
            <Bar dataKey="count" radius={[4, 4, 4, 4]}>
              {data.map((entry) => (
                <Cell key={entry.day} fill={entry.count === peak ? "#60a5fa" : "#404040"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
