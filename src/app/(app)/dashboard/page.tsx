"use client";

import { Radio, Search, Waves } from "lucide-react";
import { useMemo, useState } from "react";
import {
  ENABLED_CAPABILITIES_COUNT,
  MAX_COMPETITORS,
  MOCK_ENTITIES,
  MOCK_SIGNALS,
  type Severity,
} from "@/lib/mock-dashboard-data";
import { RecentSignalsFeed } from "./_components/recent-signals-feed";

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
      Icon: Waves,
    },
    {
      label: "Signals this week",
      value: `${signals.length}`,
      Icon: Radio,
    },
    {
      label: "Active capabilities",
      value: `${ENABLED_CAPABILITIES_COUNT}`,
      Icon: Waves,
    },
  ];

  return (
    <div className="flex flex-col bg-neutral-950 min-h-svh">
      <div className="flex items-center gap-3 px-6 pt-4 pb-4 border-b border-neutral-800">
        <h1 className="flex-1 text-xl font-semibold text-neutral-100">Dashboard</h1>
      </div>

      <div className="space-y-5 p-5">
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          {cards.map((card) => (
            <div
              key={card.label}
              className="aspect-square sm:aspect-auto sm:min-h-40 p-5 bg-neutral-900 rounded-2xl border border-neutral-800 flex flex-col justify-between gap-4"
            >
              <div className="size-9 shrink-0 bg-neutral-800 rounded-lg border border-neutral-700 flex justify-center items-center text-neutral-100">
                <card.Icon size={18} />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-neutral-100 text-3xl font-semibold leading-8">
                  {card.value}
                </span>
                <span className="text-neutral-400 text-sm font-normal leading-[21px] truncate">
                  {card.label}
                </span>
              </div>
            </div>
          ))}
        </div>

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
