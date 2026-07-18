// Client-safe view models and pure aggregation helpers for the dashboard.
// Server components map DB rows into these shapes (see dashboard-mappers.ts)
// so client bundles never pull in the Drizzle schema.

export type Severity = "p0" | "p1" | "p2" | "p3";
export type Category = "seo" | "geo" | "mentions";

export const MAX_COMPETITORS = 5;

export interface DashboardEntity {
  id: string;
  role: "primary" | "competitor";
  brandName: string;
  domain: string;
}

export interface DashboardSignal {
  id: string;
  title: string;
  severity: Severity;
  category: Category;
  capabilityLabel: string;
  entityId: string;
  sourceUrl?: string;
  /** ISO timestamp. */
  lastSeenAt: string;
}

export interface TrendPoint {
  date: string;
  count: number;
}

export interface WeekdayActivity {
  day: string;
  count: number;
}

export interface TopCapability {
  capabilityLabel: string;
  category: Category;
  signalCount: number;
  severity: Severity;
}

export type StatDeltaDirection = "up" | "down";

export interface StatDelta {
  direction: StatDeltaDirection;
  percent: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const SEVERITY_RANK: Record<Severity, number> = { p0: 0, p1: 1, p2: 2, p3: 3 };

function dayLabel(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Daily signal counts (by lastSeenAt) for the trailing `days` days, oldest first. */
export function computeSignalTrend(
  signals: DashboardSignal[],
  days = 14,
): TrendPoint[] {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const counts = new Map<string, number>();
  for (const s of signals) {
    const key = new Date(s.lastSeenAt).toDateString();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const points: TrendPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(todayStart.getTime() - i * DAY_MS);
    points.push({ date: dayLabel(d), count: counts.get(d.toDateString()) ?? 0 });
  }
  return points;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Signal counts bucketed by day of week (Sun..Sat). */
export function computeWeekdayActivity(
  signals: DashboardSignal[],
): WeekdayActivity[] {
  const counts = new Array<number>(7).fill(0);
  for (const s of signals) {
    counts[new Date(s.lastSeenAt).getDay()] += 1;
  }
  return WEEKDAYS.map((day, i) => ({ day, count: counts[i] }));
}

/** Capabilities ranked by signal volume; severity is the worst seen. */
export function computeTopCapabilities(
  signals: DashboardSignal[],
  limit = 5,
): TopCapability[] {
  const byLabel = new Map<string, TopCapability>();
  for (const s of signals) {
    const existing = byLabel.get(s.capabilityLabel);
    if (!existing) {
      byLabel.set(s.capabilityLabel, {
        capabilityLabel: s.capabilityLabel,
        category: s.category,
        signalCount: 1,
        severity: s.severity,
      });
    } else {
      existing.signalCount += 1;
      if (SEVERITY_RANK[s.severity] < SEVERITY_RANK[existing.severity]) {
        existing.severity = s.severity;
      }
    }
  }
  return [...byLabel.values()]
    .sort((a, b) => b.signalCount - a.signalCount)
    .slice(0, limit);
}

/** Week-over-week style delta. Undefined when there's no meaningful baseline. */
export function computeDelta(
  current: number,
  previous: number,
): StatDelta | undefined {
  if (previous <= 0) return undefined;
  const percent = Math.round(((current - previous) / previous) * 100);
  if (percent === 0) return undefined;
  return { direction: percent > 0 ? "up" : "down", percent: Math.abs(percent) };
}
