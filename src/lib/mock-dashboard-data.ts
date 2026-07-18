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
