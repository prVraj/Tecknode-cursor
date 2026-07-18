const PSI_API_URL =
  "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";
const CRUX_API_URL =
  "https://chromeuxreport.googleapis.com/v1/records:queryRecord";

export type CwvCategory = "FAST" | "MODERATE" | "SLOW" | "NO_DATA";

export type CwvMetric = {
  value: number | null;
  category: CwvCategory;
  displayValue: string | null;
};

export type CwvLabData = {
  lcp: CwvMetric;
  fcp: CwvMetric;
  cls: CwvMetric;
  tbt: CwvMetric;
  si: CwvMetric;
  performanceScore: number | null;
};

export type CwvFieldMetric = {
  p75: number | null;
  category: CwvCategory;
};

export type CwvFieldData = {
  lcp: CwvFieldMetric;
  cls: CwvFieldMetric;
  inp: CwvFieldMetric;
  fcp: CwvFieldMetric;
  hasData: boolean;
};

export type CwvUrlResult = {
  url: string;
  strategy: "mobile" | "desktop";
  lab: CwvLabData;
  field: CwvFieldData;
  regressions: string[];
  dataIssue?: string;
};

export type CwvResponse = {
  source: "pagespeed";
  dataIssues: string[];
  results: CwvUrlResult[];
};

export class GooglePsiError extends Error {}

function auditScoreToCategory(score: number | null | undefined): CwvCategory {
  if (score == null) return "NO_DATA";
  if (score >= 0.9) return "FAST";
  if (score >= 0.5) return "MODERATE";
  return "SLOW";
}

function cruxCategoryFromHistogram(
  histogram:
    | Array<{ start: number; end?: number; density: number }>
    | undefined,
  p75: number | null,
): CwvCategory {
  if (!histogram || p75 == null) return "NO_DATA";
  // Histogram bins: [0] = good, [1] = needs improvement, [2] = poor
  // Determine category by which bin the p75 falls into
  const good = histogram[0];
  const poor = histogram[2];
  if (!(good && poor)) return "NO_DATA";
  const goodEnd = good.end ?? Number.POSITIVE_INFINITY;
  const needsEnd = poor.start;
  if (p75 < goodEnd) return "FAST";
  if (p75 < needsEnd) return "MODERATE";
  return "SLOW";
}

type PsiAudit = {
  numericValue?: number;
  displayValue?: string;
  score?: number | null;
};

type PsiApiResponse = {
  lighthouseResult?: {
    audits?: Record<string, PsiAudit>;
    categories?: {
      performance?: { score?: number | null };
    };
  };
  error?: { message?: string };
};

export async function fetchPageSpeedInsights(params: {
  url: string;
  strategy: "mobile" | "desktop";
  apiKey: string;
}): Promise<CwvLabData> {
  const { url, strategy, apiKey } = params;
  const endpoint = new URL(PSI_API_URL);
  endpoint.searchParams.set("url", url);
  endpoint.searchParams.set("strategy", strategy);
  endpoint.searchParams.set("key", apiKey);

  const res = await fetch(endpoint.toString());
  if (!res.ok) {
    throw new GooglePsiError(
      `PSI API returned ${res.status} for ${url} (${strategy})`,
    );
  }

  const data = (await res.json()) as PsiApiResponse;

  if (data.error?.message) {
    throw new GooglePsiError(data.error.message);
  }

  const audits = data.lighthouseResult?.audits ?? {};
  const perfScore = data.lighthouseResult?.categories?.performance?.score;

  function toMetric(key: string): CwvMetric {
    const audit = audits[key];
    return {
      value: audit?.numericValue ?? null,
      category: auditScoreToCategory(audit?.score),
      displayValue: audit?.displayValue ?? null,
    };
  }

  return {
    lcp: toMetric("largest-contentful-paint"),
    fcp: toMetric("first-contentful-paint"),
    cls: toMetric("cumulative-layout-shift"),
    tbt: toMetric("total-blocking-time"),
    si: toMetric("speed-index"),
    performanceScore: perfScore != null ? Math.round(perfScore * 100) : null,
  };
}

type CruxMetricEntry = {
  histogram?: Array<{ start: number; end?: number; density: number }>;
  percentiles?: { p75?: number };
};

type CruxApiResponse = {
  record?: {
    metrics?: {
      largest_contentful_paint?: CruxMetricEntry;
      cumulative_layout_shift?: CruxMetricEntry;
      interaction_to_next_paint?: CruxMetricEntry;
      first_contentful_paint?: CruxMetricEntry;
    };
  };
  error?: { code?: number; message?: string };
};

export async function fetchCruxFieldData(params: {
  url: string;
  strategy: "mobile" | "desktop";
  apiKey: string;
}): Promise<CwvFieldData> {
  const { url, strategy, apiKey } = params;
  const formFactor = strategy === "mobile" ? "PHONE" : "DESKTOP";

  const origin = (() => {
    try {
      const u = new URL(url);
      return `${u.protocol}//${u.hostname}`;
    } catch {
      return url;
    }
  })();

  const endpoint = `${CRUX_API_URL}?key=${apiKey}`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ origin, formFactor }),
  });

  if (res.status === 404) {
    return {
      lcp: { p75: null, category: "NO_DATA" },
      cls: { p75: null, category: "NO_DATA" },
      inp: { p75: null, category: "NO_DATA" },
      fcp: { p75: null, category: "NO_DATA" },
      hasData: false,
    };
  }

  if (!res.ok) {
    throw new GooglePsiError(
      `CrUX API returned ${res.status} for ${url} (${strategy})`,
    );
  }

  const data = (await res.json()) as CruxApiResponse;

  if (data.error?.message && data.error.code !== 404) {
    throw new GooglePsiError(data.error.message);
  }

  const metrics = data.record?.metrics;

  if (!metrics) {
    return {
      lcp: { p75: null, category: "NO_DATA" },
      cls: { p75: null, category: "NO_DATA" },
      inp: { p75: null, category: "NO_DATA" },
      fcp: { p75: null, category: "NO_DATA" },
      hasData: false,
    };
  }

  function toFieldMetric(entry: CruxMetricEntry | undefined): CwvFieldMetric {
    const p75 = entry?.percentiles?.p75 ?? null;
    return {
      p75,
      category: cruxCategoryFromHistogram(entry?.histogram, p75),
    };
  }

  return {
    lcp: toFieldMetric(metrics.largest_contentful_paint),
    cls: toFieldMetric(metrics.cumulative_layout_shift),
    inp: toFieldMetric(metrics.interaction_to_next_paint),
    fcp: toFieldMetric(metrics.first_contentful_paint),
    hasData: true,
  };
}

function formatRegressionLabel(
  metricName: string,
  value: number | null,
  category: CwvCategory,
  isMs: boolean,
): string {
  const categoryLabel = category === "SLOW" ? "Poor" : "Needs Improvement";
  if (value == null) return `${metricName}: unknown (${categoryLabel})`;
  const display = isMs ? `${(value / 1000).toFixed(1)}s` : value.toFixed(2);
  return `${metricName}: ${display} (${categoryLabel})`;
}

const EMPTY_LAB: CwvLabData = {
  lcp: { value: null, category: "NO_DATA", displayValue: null },
  fcp: { value: null, category: "NO_DATA", displayValue: null },
  cls: { value: null, category: "NO_DATA", displayValue: null },
  tbt: { value: null, category: "NO_DATA", displayValue: null },
  si: { value: null, category: "NO_DATA", displayValue: null },
  performanceScore: null,
};

const EMPTY_FIELD: CwvFieldData = {
  lcp: { p75: null, category: "NO_DATA" },
  cls: { p75: null, category: "NO_DATA" },
  inp: { p75: null, category: "NO_DATA" },
  fcp: { p75: null, category: "NO_DATA" },
  hasData: false,
};

function resolveLabResult(
  result: PromiseSettledResult<CwvLabData> | undefined,
  issues: string[],
): CwvLabData {
  if (result?.status === "fulfilled") return result.value;
  const reason =
    result?.status === "rejected"
      ? String((result as PromiseRejectedResult).reason)
      : "unknown error";
  issues.push(`PSI fetch failed: ${reason}`);
  return EMPTY_LAB;
}

function resolveFieldResult(
  result: PromiseSettledResult<CwvFieldData> | undefined,
  issues: string[],
): CwvFieldData {
  if (result?.status === "fulfilled") return result.value;
  const reason =
    result?.status === "rejected"
      ? String((result as PromiseRejectedResult).reason)
      : "unknown error";
  issues.push(`CrUX fetch failed: ${reason}`);
  return EMPTY_FIELD;
}

function detectRegressions(lab: CwvLabData, field: CwvFieldData): string[] {
  const regressions: string[] = [];
  if (lab.lcp.category === "SLOW" || lab.lcp.category === "MODERATE") {
    regressions.push(
      formatRegressionLabel("LCP", lab.lcp.value, lab.lcp.category, true),
    );
  }
  if (lab.cls.category === "SLOW" || lab.cls.category === "MODERATE") {
    regressions.push(
      formatRegressionLabel("CLS", lab.cls.value, lab.cls.category, false),
    );
  }
  if (field.inp.category === "SLOW" || field.inp.category === "MODERATE") {
    regressions.push(
      formatRegressionLabel("INP", field.inp.p75, field.inp.category, true),
    );
  }
  return regressions;
}

export function buildCwvResponse(params: {
  urls: string[];
  strategy: "mobile" | "desktop";
  psiResults: PromiseSettledResult<CwvLabData>[];
  cruxResults: PromiseSettledResult<CwvFieldData>[];
  dataIssues: string[];
}): CwvResponse {
  const { urls, strategy, psiResults, cruxResults, dataIssues } = params;

  const results: CwvUrlResult[] = urls.map((url, i) => {
    const issues: string[] = [];
    const lab = resolveLabResult(psiResults[i], issues);
    const field = resolveFieldResult(cruxResults[i], issues);
    const regressions = detectRegressions(lab, field);

    const result: CwvUrlResult = { url, strategy, lab, field, regressions };
    if (issues.length > 0) result.dataIssue = issues.join("; ");
    return result;
  });

  return { source: "pagespeed", dataIssues, results };
}
