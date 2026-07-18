export type Severity = "p0" | "p1" | "p2" | "p3";
export type Category = "seo" | "geo" | "mentions";

export interface MockEntity {
  id: string;
  role: "primary" | "competitor";
  brandName: string;
  domain: string;
}

export interface MockSignal {
  id: string;
  title: string;
  severity: Severity;
  category: Category;
  capabilityLabel: string;
  entityId: string;
  sourceUrl?: string;
  lastSeenAt: string;
}

export const MAX_COMPETITORS = 5;

export const MOCK_ENTITIES: MockEntity[] = [
  { id: "entity-primary", role: "primary", brandName: "Signals", domain: "signals.dev" },
  { id: "entity-comp-1", role: "competitor", brandName: "Northwind Analytics", domain: "northwind.io" },
  { id: "entity-comp-2", role: "competitor", brandName: "Aurora Insights", domain: "auroralabs.ai" },
];

function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

export const MOCK_SIGNALS: MockSignal[] = [
  {
    id: "sig-1",
    title: "Lost #1 ranking for \"marketing intelligence platform\"",
    severity: "p0",
    category: "seo",
    capabilityLabel: "Keyword Rankings",
    entityId: "entity-primary",
    sourceUrl: "https://search.google.com",
    lastSeenAt: hoursAgo(2),
  },
  {
    id: "sig-2",
    title: "Aurora Insights overtook you in AI citation share for \"AI SEO tools\"",
    severity: "p0",
    category: "geo",
    capabilityLabel: "Competitor AI Visibility",
    entityId: "entity-comp-2",
    sourceUrl: "https://chat.openai.com",
    lastSeenAt: hoursAgo(3),
  },
  {
    id: "sig-3",
    title: "New lookalike domain detected: signals-app.com",
    severity: "p1",
    category: "mentions",
    capabilityLabel: "Lookalike Domains",
    entityId: "entity-primary",
    sourceUrl: "https://whois.com",
    lastSeenAt: hoursAgo(5),
  },
  {
    id: "sig-4",
    title: "Core Web Vitals regression on /pricing (LCP +1.2s)",
    severity: "p1",
    category: "seo",
    capabilityLabel: "Core Web Vitals",
    entityId: "entity-primary",
    lastSeenAt: hoursAgo(8),
  },
  {
    id: "sig-5",
    title: "Northwind Analytics launched a new comparison landing page",
    severity: "p2",
    category: "seo",
    capabilityLabel: "Competitor Content Gaps",
    entityId: "entity-comp-1",
    sourceUrl: "https://northwind.io/vs",
    lastSeenAt: hoursAgo(14),
  },
  {
    id: "sig-6",
    title: "Sentiment dip in AI answers mentioning your brand",
    severity: "p2",
    category: "geo",
    capabilityLabel: "AI Sentiment",
    entityId: "entity-primary",
    lastSeenAt: hoursAgo(20),
  },
  {
    id: "sig-7",
    title: "Positive Reddit thread mentioning your product in r/SaaS",
    severity: "p3",
    category: "mentions",
    capabilityLabel: "Brand Mentions",
    entityId: "entity-primary",
    sourceUrl: "https://reddit.com/r/saas",
    lastSeenAt: hoursAgo(27),
  },
  {
    id: "sig-8",
    title: "Sitemap changed: 4 new URLs added",
    severity: "p3",
    category: "seo",
    capabilityLabel: "Sitemap Diff",
    entityId: "entity-primary",
    lastSeenAt: hoursAgo(33),
  },
];

export const ENABLED_CAPABILITIES_COUNT = 41;

export interface TrendPoint {
  date: string;
  count: number;
}

function daysAgoLabel(daysAgo: number): string {
  const d = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const TREND_COUNTS = [4, 6, 5, 8, 7, 10, 9, 12, 11, 14, 13, 16, 15, 18];

export const MOCK_SIGNAL_TREND: TrendPoint[] = TREND_COUNTS.map((count, i) => ({
  date: daysAgoLabel(TREND_COUNTS.length - 1 - i),
  count,
}));

export interface WeekdayActivity {
  day: string;
  count: number;
}

export const MOCK_WEEKDAY_ACTIVITY: WeekdayActivity[] = [
  { day: "Sun", count: 6 },
  { day: "Mon", count: 11 },
  { day: "Tue", count: 18 },
  { day: "Wed", count: 9 },
  { day: "Thu", count: 13 },
  { day: "Fri", count: 8 },
  { day: "Sat", count: 5 },
];

export const CAPABILITY_COVERAGE = {
  active: ENABLED_CAPABILITIES_COUNT,
  total: 64,
};

export interface TopCapability {
  capabilityLabel: string;
  category: Category;
  signalCount: number;
  severity: Severity;
}

export const MOCK_TOP_CAPABILITIES: TopCapability[] = [
  { capabilityLabel: "Keyword Rankings", category: "seo", signalCount: 14, severity: "p0" },
  { capabilityLabel: "Competitor AI Visibility", category: "geo", signalCount: 11, severity: "p0" },
  { capabilityLabel: "Core Web Vitals", category: "seo", signalCount: 9, severity: "p1" },
  { capabilityLabel: "AI Sentiment", category: "geo", signalCount: 7, severity: "p2" },
  { capabilityLabel: "Lookalike Domains", category: "mentions", signalCount: 4, severity: "p1" },
];

export type StatDeltaDirection = "up" | "down";

export interface StatDelta {
  direction: StatDeltaDirection;
  percent: number;
}

export const STAT_DELTAS: Record<"competitors" | "signals" | "capabilities" | "critical", StatDelta> = {
  competitors: { direction: "up", percent: 12 },
  signals: { direction: "up", percent: 24 },
  capabilities: { direction: "down", percent: 3 },
  critical: { direction: "up", percent: 8 },
};
