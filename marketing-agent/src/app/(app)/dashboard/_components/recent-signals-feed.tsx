import { ExternalLink, Plus } from "lucide-react";
import Link from "next/link";
import {
  MAX_COMPETITORS,
  type MockEntity,
  type MockSignal,
  type Severity,
} from "@/lib/mock-dashboard-data";

interface RecentSignalsFeedProps {
  signals: MockSignal[];
  entities: MockEntity[];
}

const SEVERITY_BADGE: Record<
  Severity,
  { label: string; bg: string; dot: string; text: string }
> = {
  p0: {
    label: "Critical",
    bg: "bg-red-950/60 border border-red-900/50",
    dot: "bg-red-500",
    text: "text-red-400",
  },
  p1: {
    label: "High",
    bg: "bg-blue-950/60 border border-blue-900/50",
    dot: "bg-blue-500",
    text: "text-blue-400",
  },
  p2: {
    label: "Medium",
    bg: "bg-yellow-950/60 border border-yellow-900/50",
    dot: "bg-yellow-500",
    text: "text-yellow-400",
  },
  p3: {
    label: "Low",
    bg: "bg-green-950/60 border border-green-900/50",
    dot: "bg-green-500",
    text: "text-green-400",
  },
};

function timeAgo(date: string): string {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function RecentSignalsFeed({ signals, entities }: RecentSignalsFeedProps) {
  const entityMap = new Map(entities.map((e) => [e.id, e]));

  if (signals.length === 0) {
    const competitorCount = entities.filter((e) => e.role === "competitor").length;
    const remaining = Math.max(0, MAX_COMPETITORS - competitorCount);

    return (
      <div className="flex flex-col justify-center items-center py-10">
        <Link
          href="/dashboard/tracking"
          className="w-96 max-w-full p-10 bg-neutral-900 rounded-2xl border border-neutral-800 flex flex-col justify-center items-center gap-2 transition-colors hover:bg-neutral-800 hover:border-neutral-700"
        >
          <div className="size-10 bg-neutral-800 rounded-lg flex justify-center items-center">
            <Plus size={16} className="text-neutral-100" />
          </div>
          <p className="text-neutral-300 text-sm font-normal leading-[21px] text-center">
            Add competitors to get signals and stay updated.
          </p>
          <p className="text-neutral-500 text-xs font-normal leading-3">
            {remaining} {remaining === 1 ? "slot" : "slots"} remaining
          </p>
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {signals.map((signal) => {
        const entity = entityMap.get(signal.entityId);
        const entityName = entity ? entity.brandName : "Unknown";
        const badge = SEVERITY_BADGE[signal.severity];

        return (
          <div
            key={signal.id}
            className="self-stretch p-3 rounded-xl bg-neutral-900 border border-neutral-800 inline-flex justify-start items-start gap-2 transition-colors hover:border-neutral-700"
          >
            <div className="flex-1 inline-flex flex-col justify-start items-start gap-4">
              <div className="inline-flex justify-start items-center gap-3">
                <span className="text-neutral-100 text-sm font-medium leading-[21px]">
                  {signal.title}
                </span>
                <div
                  className={`px-2 py-1 ${badge.bg} rounded-md flex justify-center items-center gap-1 shrink-0`}
                >
                  <div className={`size-1.5 ${badge.dot} rounded-full`} />
                  <span className={`${badge.text} text-xs font-medium leading-3`}>
                    {badge.label}
                  </span>
                </div>
              </div>
              <div className="inline-flex justify-start items-center gap-3">
                <span className="text-neutral-400 text-xs font-normal leading-3">
                  {entityName}
                </span>
                <div className="w-px self-stretch bg-neutral-700" />
                <span className="text-neutral-400 text-xs font-normal leading-3">
                  {signal.capabilityLabel}
                </span>
              </div>
            </div>
            <div className="self-stretch inline-flex flex-col justify-between items-end gap-2 shrink-0">
              {signal.sourceUrl ? (
                <a
                  href={signal.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-neutral-400 hover:text-neutral-100 transition-colors"
                >
                  <span className="text-xs leading-3">Source</span>
                  <ExternalLink size={14} />
                </a>
              ) : null}
              <span className="text-neutral-500 text-xs font-normal leading-[18px]">
                {timeAgo(signal.lastSeenAt)}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
