import dns from "node:dns/promises";
import { signalSnapshotRepo } from "@/server/db/repos/signal-snapshot.repo";
import type { NewSignal } from "@/server/db/schema";
import { logExternalFailure } from "@/utils/log-external";
import type { ModuleRunner } from "../dispatcher";
import { getBrand } from "./module-helpers";

// Caps to keep DNS/RDAP fan-out bounded — typosquat permutation space is large.
const MAX_CANDIDATES = 220;
const MAX_ENRICHED = 40; // RDAP + MX lookups only on resolving candidates
const RECENTLY_REGISTERED_DAYS = 30;
const DNS_CONCURRENCY = 20;

const COMMON_TLDS = [
  "com",
  "net",
  "org",
  "io",
  "co",
  "app",
  "ai",
  "info",
  "online",
  "site",
  "xyz",
  "shop",
];

// Adjacent-key map (QWERTY) for typo replacement / insertion fuzzers.
const KEYBOARD: Record<string, string> = {
  q: "wa",
  w: "qase",
  e: "wsdr",
  r: "edft",
  t: "rfgy",
  y: "tghu",
  u: "yhji",
  i: "ujko",
  o: "iklp",
  p: "ol",
  a: "qwsz",
  s: "awedxz",
  d: "serfcx",
  f: "drtgvc",
  g: "ftyhbv",
  h: "gyujnb",
  j: "huikmn",
  k: "jiolm",
  l: "kop",
  z: "asx",
  x: "zsdc",
  c: "xdfv",
  v: "cfgb",
  b: "vghn",
  n: "bhjm",
  m: "njk",
};

// Single-char homoglyph swaps (visual confusables).
const HOMOGLYPHS: Record<string, string[]> = {
  o: ["0"],
  l: ["1", "i"],
  i: ["1", "l"],
  e: ["3"],
  a: ["4"],
  s: ["5"],
  b: ["8"],
  g: ["9"],
};

export interface Lookalike {
  domain: string;
  fuzzer: string;
  ips: string[];
  hasMx: boolean;
  registrar: string | null;
  createdAt: string | null;
  ageDays: number | null;
  recentlyRegistered: boolean;
}

export interface LookalikeDomainsOutput extends Record<string, unknown> {
  source: string;
  domain: string;
  candidatesChecked: number;
  registeredLookalikeCount: number;
  lookalikes: Lookalike[];
  dataIssues: string[];
}

function rootDomain(rawDomain: string): string {
  return rawDomain
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .split("/")[0]!
    .split(":")[0]!
    .toLowerCase();
}

/** Split into the registrable label + everything after the first dot as the TLD. */
function splitDomain(domain: string): { name: string; tld: string } {
  const dot = domain.indexOf(".");
  if (dot === -1) return { name: domain, tld: "com" };
  return { name: domain.slice(0, dot), tld: domain.slice(dot + 1) };
}

/** dnstwist-style permutation generator (pure JS). */
function generatePermutations(name: string, tld: string): Map<string, string> {
  // domain -> fuzzer label
  const out = new Map<string, string>();
  const add = (n: string, t: string, fuzzer: string) => {
    const candidate = `${n}.${t}`;
    if (n.length < 1) return;
    if (candidate === `${name}.${tld}`) return;
    if (!out.has(candidate)) out.set(candidate, fuzzer);
  };

  const chars = name.split("");

  // Omission — drop one char.
  for (let i = 0; i < chars.length; i++) {
    add(name.slice(0, i) + name.slice(i + 1), tld, "omission");
  }
  // Repetition — double one char.
  for (let i = 0; i < chars.length; i++) {
    add(name.slice(0, i) + chars[i] + name.slice(i), tld, "repetition");
  }
  // Transposition — swap adjacent chars.
  for (let i = 0; i < chars.length - 1; i++) {
    const swapped = [...chars];
    [swapped[i], swapped[i + 1]] = [swapped[i + 1]!, swapped[i]!];
    add(swapped.join(""), tld, "transposition");
  }
  // Replacement — adjacent-key substitution.
  for (let i = 0; i < chars.length; i++) {
    const near = KEYBOARD[chars[i]!];
    if (!near) continue;
    for (const r of near) {
      add(name.slice(0, i) + r + name.slice(i + 1), tld, "replacement");
    }
  }
  // Insertion — adjacent-key insertion.
  for (let i = 0; i < chars.length; i++) {
    const near = KEYBOARD[chars[i]!];
    if (!near) continue;
    for (const r of near) {
      add(name.slice(0, i) + r + name.slice(i), tld, "insertion");
    }
  }
  // Homoglyph — visual confusables.
  for (let i = 0; i < chars.length; i++) {
    const swaps = HOMOGLYPHS[chars[i]!];
    if (!swaps) continue;
    for (const s of swaps) {
      add(name.slice(0, i) + s + name.slice(i + 1), tld, "homoglyph");
    }
  }
  // Multi-char homoglyphs.
  if (name.includes("m")) add(name.replace("m", "rn"), tld, "homoglyph");
  if (name.includes("w")) add(name.replace("w", "vv"), tld, "homoglyph");
  // Hyphenation — insert a hyphen between chars.
  for (let i = 1; i < chars.length; i++) {
    add(`${name.slice(0, i)}-${name.slice(i)}`, tld, "hyphenation");
  }
  // Bitsquatting — flip one bit of each lowercase letter.
  for (let i = 0; i < chars.length; i++) {
    const code = name.charCodeAt(i);
    for (let bit = 0; bit < 7; bit++) {
      const flipped = String.fromCharCode(code ^ (1 << bit));
      if (/[a-z0-9-]/.test(flipped)) {
        add(
          name.slice(0, i) + flipped + name.slice(i + 1),
          tld,
          "bitsquatting",
        );
      }
    }
  }
  // TLD swap — same name, different TLD.
  for (const t of COMMON_TLDS) {
    if (t !== tld) add(name, t, "tld-swap");
  }

  return out;
}

async function resolveDomain(domain: string): Promise<string[]> {
  try {
    return await dns.resolve4(domain);
  } catch {
    return [];
  }
}

async function resolveMxPresent(domain: string): Promise<boolean> {
  try {
    const mx = await dns.resolveMx(domain);
    return mx.length > 0;
  } catch {
    return false;
  }
}

async function fetchRdap(
  domain: string,
): Promise<{ createdAt: string | null; registrar: string | null }> {
  try {
    const res = await fetch(`https://rdap.org/domain/${domain}`, {
      signal: AbortSignal.timeout(10_000),
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return { createdAt: null, registrar: null };
    const data = (await res.json()) as {
      events?: Array<{ eventAction: string; eventDate: string }>;
      entities?: Array<{ roles?: string[]; vcardArray?: unknown[] }>;
    };
    const created =
      data.events?.find((e) => e.eventAction === "registration")?.eventDate ??
      null;
    const registrarEntity = data.entities?.find((e) =>
      e.roles?.includes("registrar"),
    );
    const vcard = Array.isArray(registrarEntity?.vcardArray)
      ? (registrarEntity.vcardArray[1] as unknown[])
      : null;
    const fnEntry = Array.isArray(vcard)
      ? vcard.find(
          (entry): entry is unknown[] =>
            Array.isArray(entry) && entry[0] === "fn",
        )
      : null;
    const registrar =
      Array.isArray(fnEntry) && typeof fnEntry[3] === "string"
        ? fnEntry[3]
        : null;
    return { createdAt: created, registrar };
  } catch (err) {
    logExternalFailure("fetch", "brand_lookalike_domains.rdap", err, {
      domain,
    });
    return { createdAt: null, registrar: null };
  }
}

/** Map over items with a bounded concurrency pool. */
async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, () =>
    (async () => {
      while (cursor < items.length) {
        const idx = cursor++;
        results[idx] = await fn(items[idx]!);
      }
    })(),
  );
  await Promise.all(workers);
  return results;
}

export interface RegisteredLookalike {
  domain: string;
  fuzzer: string;
  ips: string[];
}

/**
 * Lightweight discovery used by sibling brand-protection modules (phishing,
 * trademark) as the recompute fallback when no same-day lookalike snapshot
 * exists. Resolves permutations only — no RDAP/MX enrichment.
 */
export async function discoverRegisteredLookalikes(
  rawDomain: string,
): Promise<RegisteredLookalike[]> {
  const domain = rootDomain(rawDomain);
  const { name, tld } = splitDomain(domain);
  const permutations = [...generatePermutations(name, tld).entries()].slice(
    0,
    MAX_CANDIDATES,
  );
  const resolved = await mapPool(
    permutations,
    DNS_CONCURRENCY,
    async ([cand, fuzzer]) => {
      const ips = await resolveDomain(cand);
      return ips.length > 0 ? { domain: cand, fuzzer, ips } : null;
    },
  );
  return resolved.filter((r): r is RegisteredLookalike => r !== null);
}

export const runBrandLookalikeDomains: ModuleRunner = async ({
  userId,
  entity,
  run,
}) => {
  const domain = rootDomain(entity.domain);
  const brand = getBrand(entity);
  const dataIssues: string[] = [];

  const registered = await discoverRegisteredLookalikes(domain);
  const candidatesChecked = (() => {
    const { name, tld } = splitDomain(domain);
    return Math.min(generatePermutations(name, tld).size, MAX_CANDIDATES);
  })();

  // Enrich the resolving ones with MX + RDAP (registration date / registrar).
  const enriched = await mapPool(
    registered.slice(0, MAX_ENRICHED),
    DNS_CONCURRENCY,
    async ({ domain: cand, fuzzer, ips }): Promise<Lookalike> => {
      const [hasMx, rdap] = await Promise.all([
        resolveMxPresent(cand),
        fetchRdap(cand),
      ]);
      const ageDays =
        rdap.createdAt && !Number.isNaN(new Date(rdap.createdAt).getTime())
          ? Math.floor(
              (Date.now() - new Date(rdap.createdAt).getTime()) / 86_400_000,
            )
          : null;
      return {
        domain: cand,
        fuzzer,
        ips,
        hasMx,
        registrar: rdap.registrar,
        createdAt: rdap.createdAt,
        ageDays,
        recentlyRegistered:
          ageDays !== null && ageDays <= RECENTLY_REGISTERED_DAYS,
      };
    },
  );

  if (registered.length > MAX_ENRICHED) {
    dataIssues.push(
      `${registered.length - MAX_ENRICHED} additional lookalikes resolved but were not enriched (cap ${MAX_ENRICHED})`,
    );
  }

  const output: LookalikeDomainsOutput = {
    source: "dnstwist+dns+rdap",
    domain,
    candidatesChecked,
    registeredLookalikeCount: registered.length,
    lookalikes: enriched,
    dataIssues,
  };

  // ── Alerts ──────────────────────────────────────────────────────────────
  const signals: NewSignal[] = [];
  const prev = await signalSnapshotRepo.findLatest(
    entity.id,
    "brand_lookalike_domains",
  );

  if (!prev) {
    signals.push({
      userId,
      subjectEntityId: entity.id,
      capabilityKey: "brand_lookalike_domains",
      severity: registered.length > 0 ? "p2" : "p3",
      title:
        registered.length > 0
          ? `${registered.length} lookalike domain${registered.length !== 1 ? "s" : ""} found for ${brand}`
          : `Lookalike baseline for ${brand}: none registered`,
      summary:
        registered.length > 0
          ? `Registered typosquats: ${registered
              .slice(0, 8)
              .map((r) => r.domain)
              .join(", ")}`
          : `Checked ${candidatesChecked} permutations of ${domain}; none resolve.`,
      evidence: {
        sourceUrl: `https://${domain}`,
        runId: run.id,
        details: { lookalikes: enriched, baseline: true },
      },
      confidence: "0.85",
      dedupKey: `brand_lookalike_domains:${entity.id}:baseline`,
    });
  } else {
    const prevDomains = new Set(
      ((prev.payload as LookalikeDomainsOutput | null)?.lookalikes ?? []).map(
        (l) => l.domain,
      ),
    );
    const fresh = enriched.filter((l) => !prevDomains.has(l.domain));
    for (const l of fresh) {
      const dangerous = l.hasMx || l.recentlyRegistered;
      signals.push({
        userId,
        subjectEntityId: entity.id,
        capabilityKey: "brand_lookalike_domains",
        severity: dangerous ? "p1" : "p2",
        title: `New lookalike domain registered: ${l.domain}`,
        summary: [
          `Mimics ${domain} via ${l.fuzzer}.`,
          l.hasMx ? "Has MX records (email-capable — phishing risk)." : null,
          l.recentlyRegistered ? `Registered ${l.ageDays} day(s) ago.` : null,
          l.registrar ? `Registrar: ${l.registrar}.` : null,
        ]
          .filter(Boolean)
          .join(" "),
        evidence: {
          sourceUrl: `https://${l.domain}`,
          runId: run.id,
          details: { lookalike: l },
        },
        confidence: "0.9",
        dedupKey: `brand_lookalike_domains:${entity.id}:new:${l.domain}`,
      });
    }
  }

  return { output, signals, costUnits: 0 };
};
