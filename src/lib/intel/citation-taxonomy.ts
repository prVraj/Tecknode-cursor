import type { CitationDomain } from "@/lib/intel/citation-sources";

/**
 * Where an AI engine's citations come from. `owned` and `competitor` are facts
 * carried on the citation itself; the rest are classified from the domain.
 *
 * `other` is load-bearing: without a fallback bucket every unrecognised domain
 * would land in `earned`, silently inflating the one bucket a customer is most
 * likely to quote back at us.
 */
export type TaxonomyBucket =
  | "owned"
  | "competitor"
  | "press"
  | "social"
  | "docs"
  | "earned"
  | "other";

export const TAXONOMY_BUCKETS: readonly TaxonomyBucket[] = [
  "owned",
  "competitor",
  "press",
  "social",
  "docs",
  "earned",
  "other",
];

/** Communities and user-generated content. */
const SOCIAL_DOMAINS = [
  "reddit.com",
  "twitter.com",
  "x.com",
  "linkedin.com",
  "facebook.com",
  "youtube.com",
  "instagram.com",
  "tiktok.com",
  "quora.com",
  "medium.com",
  "substack.com",
  "ycombinator.com",
];

/** Journalism and newswire. */
const PRESS_DOMAINS = [
  "techcrunch.com",
  "forbes.com",
  "businessinsider.com",
  "nytimes.com",
  "theverge.com",
  "wired.com",
  "bloomberg.com",
  "wsj.com",
  "reuters.com",
  "cnbc.com",
  "venturebeat.com",
  "arstechnica.com",
  "prnewswire.com",
  "businesswire.com",
];

/** Developer references, docs portals, code hosts. */
const DOCS_DOMAINS = [
  "github.com",
  "gitlab.com",
  "stackoverflow.com",
  "readthedocs.io",
  "gitbook.io",
  "npmjs.com",
  "developer.mozilla.org",
];

const DOCS_SUBDOMAIN_PATTERNS = [
  /^docs?\./,
  /^developers?\./,
  /^dev\./,
  /^api\./,
];

/** Third-party validation: review sites, directories, encyclopedias. */
const EARNED_DOMAINS = [
  "g2.com",
  "capterra.com",
  "trustpilot.com",
  "trustradius.com",
  "producthunt.com",
  "wikipedia.org",
  "gartner.com",
  "getapp.com",
  "softwareadvice.com",
];

/**
 * True when `domain` is `match` or a subdomain of it, so `en.wikipedia.org`
 * classifies alongside `wikipedia.org`. Domains reaching here come from
 * `citation-sources.ts`, already lowercased, www-stripped and path-free.
 */
function matchesDomain(domain: string, match: string): boolean {
  return domain === match || domain.endsWith(`.${match}`);
}

function matchesAny(domain: string, list: readonly string[]): boolean {
  return list.some((entry) => matchesDomain(domain, entry));
}

/**
 * Classify one cited domain. Ownership wins over content type: a competitor's
 * docs site is a `competitor` citation, not a `docs` one, because the question
 * this signal answers is "who is the AI listening to", not "what kind of page".
 */
export function classifyCitationDomain(
  citation: CitationDomain,
): TaxonomyBucket {
  if (citation.isYourDomain) return "owned";
  if (citation.isCompetitor) return "competitor";

  const domain = citation.domain;
  if (matchesAny(domain, SOCIAL_DOMAINS)) return "social";
  if (matchesAny(domain, PRESS_DOMAINS)) return "press";
  if (
    matchesAny(domain, DOCS_DOMAINS) ||
    DOCS_SUBDOMAIN_PATTERNS.some((pattern) => pattern.test(domain))
  ) {
    return "docs";
  }
  if (matchesAny(domain, EARNED_DOMAINS)) return "earned";
  return "other";
}

export type BucketStats = {
  domainCount: number;
  citationCount: number;
  /** Share of total citations, 0-100, rounded to 1dp. */
  sharePercent: number;
};

export type ClassifiedDomain = CitationDomain & { bucket: TaxonomyBucket };

export type CitationTaxonomy = {
  totalCitations: number;
  breakdown: Record<TaxonomyBucket, BucketStats>;
  domains: ClassifiedDomain[];
};

function emptyBreakdown(): Record<TaxonomyBucket, BucketStats> {
  return Object.fromEntries(
    TAXONOMY_BUCKETS.map((bucket) => [
      bucket,
      { domainCount: 0, citationCount: 0, sharePercent: 0 },
    ]),
  ) as Record<TaxonomyBucket, BucketStats>;
}

/** Bucket every cited domain and aggregate citation share per bucket. */
export function buildCitationTaxonomy(
  topDomains: readonly CitationDomain[],
): CitationTaxonomy {
  const breakdown = emptyBreakdown();
  const domains: ClassifiedDomain[] = [];
  let totalCitations = 0;

  for (const citation of topDomains) {
    const bucket = classifyCitationDomain(citation);
    domains.push({ ...citation, bucket });
    breakdown[bucket].domainCount += 1;
    breakdown[bucket].citationCount += citation.citationCount;
    totalCitations += citation.citationCount;
  }

  if (totalCitations > 0) {
    for (const bucket of TAXONOMY_BUCKETS) {
      breakdown[bucket].sharePercent =
        Math.round((breakdown[bucket].citationCount / totalCitations) * 1000) /
        10;
    }
  }

  return { totalCitations, breakdown, domains };
}
