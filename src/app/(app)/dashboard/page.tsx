"use client";

import { Bell, Download, Radio, Search, Waves } from "lucide-react";
import { useMemo, useState } from "react";
import {
  CAPABILITY_COVERAGE,
  MAX_COMPETITORS,
  MOCK_ENTITIES,
  MOCK_SIGNAL_TREND,
  MOCK_SIGNALS,
  MOCK_TOP_CAPABILITIES,
  MOCK_WEEKDAY_ACTIVITY,
  STAT_DELTAS,
  type Severity,
} from "@/lib/mock-dashboard-data";
import { CapabilityGaugeCard } from "./_components/capability-gauge-card";
import { RecentSignalsFeed } from "./_components/recent-signals-feed";
import { SignalTrendCard } from "./_components/signal-trend-card";
import { StatCard } from "./_components/stat-card";
import { TopCapabilitiesTable } from "./_components/top-capabilities-table";
import { WeekdayActivityCard } from "./_components/weekday-activity-card";

const SEVERITY_FILTERS: { label: string; value: Severity }[] = [
  { label: "Critical", value: "p0" },
  { label: "High", value: "p1" },
  { label: "Medium", value: "p2" },
  { label: "Low", value: "p3" },
];

const ALL_FILTERS = [{ label: "All", value: null }, ...SEVERITY_FILTERS] as {
  label: string;
  value: Severity | null;
}[];

export default function DashboardPage() {
  const entities = MOCK_ENTITIES;
  const signals = MOCK_SIGNALS;
  const competitors = entities.filter((e) => e.role === "competitor");
  const criticalCount = signals.filter((s) => s.severity === "p0").length;

  const [severityFilter, setSeverityFilter] = useState<Severity | null>(null);
  const [signalSearch, setSignalSearch] = useState("");

  const filteredSignals = useMemo(() => {
    let result = signals;
    if (severityFilter) result = result.filter((s) => s.severity === severityFilter);
    if (signalSearch.trim()) {
      const q = signalSearch.toLowerCase();
      result = result.filter((s) => s.title.toLowerCase().includes(q));
    }
    return result.slice(0, 10);
  }, [signals, severityFilter, signalSearch]);

  const cards = [
    {
      label: "Competitors tracked",
      value: `${competitors.length}/${MAX_COMPETITORS}`,
      icon: Waves,
      delta: STAT_DELTAS.competitors,
    },
    {
      label: "Signals this week",
      value: `${signals.length}`,
      icon: Radio,
      delta: STAT_DELTAS.signals,
    },
    {
      label: "Active capabilities",
      value: `${CAPABILITY_COVERAGE.active}`,
      icon: Waves,
      delta: STAT_DELTAS.capabilities,
    },
    {
      label: "Critical signals",
      value: `${criticalCount}`,
      icon: Radio,
      delta: STAT_DELTAS.critical,
    },
  ];

  return (
    <div className="flex flex-col bg-neutral-950 min-h-svh">
      <div className="flex items-center gap-3 px-6 pt-4 pb-4 border-b border-neutral-800">
        <h1 className="flex-1 text-xl font-semibold text-neutral-100">Dashboard</h1>
        <div className="px-3 py-1.5 rounded-lg bg-neutral-900 border border-neutral-800 text-xs text-neutral-400 hidden sm:block">
          Last 30 days
        </div>
        <button
          type="button"
          className="size-9 flex items-center justify-center rounded-lg bg-neutral-900 border border-neutral-800 text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800 transition-colors"
        >
          <Bell size={16} />
        </button>
        <button
          type="button"
          className="size-9 flex items-center justify-center rounded-lg bg-neutral-900 border border-neutral-800 text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800 transition-colors"
        >
          <Download size={16} />
        </button>
      </div>

      <div className="space-y-5 p-5">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {cards.map((card) => (
            <StatCard
              key={card.label}
              label={card.label}
              value={card.value}
              icon={card.icon}
              delta={card.delta}
            />
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <div className="lg:col-span-2">
            <SignalTrendCard trend={MOCK_SIGNAL_TREND} signals={signals} />
          </div>
          <div className="flex flex-col gap-3">
            <WeekdayActivityCard data={MOCK_WEEKDAY_ACTIVITY} />
            <CapabilityGaugeCard
              active={CAPABILITY_COVERAGE.active}
              total={CAPABILITY_COVERAGE.total}
            />
          </div>
        </div>

        <TopCapabilitiesTable capabilities={MOCK_TOP_CAPABILITIES} />

        <section>
          <div className="self-stretch inline-flex justify-between items-center mb-3 w-full">
            <div className="self-stretch p-0.5 bg-neutral-900 border border-neutral-800 rounded-lg flex justify-start items-center gap-1">
              {ALL_FILTERS.map(({ label, value }) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => setSeverityFilter(value)}
                  className={`px-3 py-1 rounded-md flex justify-start items-center gap-2 transition-colors ${
                    severityFilter === value ? "bg-neutral-700" : "hover:bg-neutral-800"
                  }`}
                >
                  <span
                    className={`text-xs font-normal leading-[18px] ${
                      severityFilter === value ? "text-neutral-100" : "text-neutral-400"
                    }`}
                  >
                    {label}
                  </span>
                </button>
              ))}
            </div>
            <div className="w-60 px-3 py-1.5 rounded-lg bg-neutral-900 border border-neutral-800 flex justify-start items-center gap-2 overflow-hidden">
              <Search size={16} className="text-neutral-500 shrink-0" />
              <input
                type="text"
                value={signalSearch}
                onChange={(e) => setSignalSearch(e.target.value)}
                placeholder="Search signals"
                className="flex-1 text-xs h-[22px] text-neutral-100 placeholder:text-neutral-500 leading-[18px] bg-transparent focus:outline-none"
              />
            </div>
          </div>

          <RecentSignalsFeed signals={filteredSignals} entities={entities} />
        </section>
      </div>
    </div>
  );
}
