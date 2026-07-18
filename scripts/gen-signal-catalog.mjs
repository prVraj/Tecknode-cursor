#!/usr/bin/env node
// Parse src/lib/intel/signal-catalog.md → src/lib/intel/signal-catalog.generated.ts.
//
// Source of truth = the .md file. Run:
//   bun run signals:gen        # regenerate the .ts after editing the .md
//   bun run signals:check      # fail if .md and .ts are out of sync (CI use)
//
// Drift check works by re-running the generator into a temp string and
// comparing to the on-disk file. If they differ, the .md was edited without
// running the generator — fail loudly.

import { readFileSync, writeFileSync } from "node:fs";
import { argv, exit } from "node:process";

const MD_PATH = "src/lib/intel/signal-catalog.md";
const TS_PATH = "src/lib/intel/signal-catalog.generated.ts";
const MODEL_PATH = "src/server/db/models/intel.model.ts";

const VALID_CATEGORIES = new Set(["seo", "geo", "mentions"]);
const VALID_FREQUENCIES = new Set([
  "daily",
  "weekly",
  "biweekly",
  "monthly",
  "on-demand",
]);
const VALID_IMPORTANCE = new Set(["high", "medium", "low", "unknown"]);
function parseBracketedList(raw, fieldName, capabilityKey) {
  const trimmed = raw.trim();
  if (!(trimmed.startsWith("[") && trimmed.endsWith("]"))) {
    throw new Error(
      `${capabilityKey} ${fieldName} must be a bracketed list: ${trimmed}`,
    );
  }
  return trimmed
    .slice(1, -1)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function loadRuntimeKeys() {
  const model = readFileSync(MODEL_PATH, "utf8");
  const block = model.split("CAPABILITY_KEYS = [")[1].split("] as const")[0];
  return new Set([...block.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]));
}

function parseMarkdown(md) {
  // Split into sections at each H2. The first chunk is the file header (skip).
  const sections = md.split(/\n## /).slice(1);
  const entries = [];

  for (const raw of sections) {
    const body = `## ${raw}`;
    const headerMatch = body.match(/^## ([a-z_]+) — (.+?)\n/);
    if (!headerMatch) {
      throw new Error(
        `Malformed header in section starting with:\n${body.slice(0, 200)}`,
      );
    }
    const [, capabilityKey, name] = headerMatch;

    // Description is the first non-empty paragraph after the header.
    const afterHeader = body.slice(headerMatch[0].length).trimStart();
    const descMatch = afterHeader.match(/^([^\n]+)\n/);
    if (!descMatch) {
      throw new Error(`No description for ${capabilityKey}`);
    }
    const description = descMatch[1].trim();

    const fields = {};
    const fieldRe = /^- ([a-zA-Z]+): (.+)$/gm;
    for (const m of body.matchAll(fieldRe)) {
      fields[m[1]] = m[2].trim();
    }

    const required = [
      "category",
      "source",
      "costPerCallUsd",
      "costNote",
      "groupedWith",
      "dependsOn",
      "runFrequency",
      "cached",
      "importanceToRevenue",
    ];
    for (const k of required) {
      if (!(k in fields)) {
        throw new Error(`${capabilityKey} missing field: ${k}`);
      }
    }

    // Coerce + validate
    const category = fields.category;
    if (!VALID_CATEGORIES.has(category)) {
      throw new Error(`${capabilityKey} invalid category: ${category}`);
    }
    const runFrequency = fields.runFrequency;
    if (!VALID_FREQUENCIES.has(runFrequency)) {
      throw new Error(`${capabilityKey} invalid runFrequency: ${runFrequency}`);
    }
    const importanceToRevenue = fields.importanceToRevenue;
    if (!VALID_IMPORTANCE.has(importanceToRevenue)) {
      throw new Error(
        `${capabilityKey} invalid importanceToRevenue: ${importanceToRevenue}`,
      );
    }
    const cached = fields.cached === "true";
    if (fields.cached !== "true" && fields.cached !== "false") {
      throw new Error(`${capabilityKey} cached must be true or false`);
    }
    const costPerCallUsd = Number(fields.costPerCallUsd);
    if (!Number.isFinite(costPerCallUsd) || costPerCallUsd < 0) {
      throw new Error(
        `${capabilityKey} invalid costPerCallUsd: ${fields.costPerCallUsd}`,
      );
    }
    const groupedWith = parseBracketedList(
      fields.groupedWith,
      "groupedWith",
      capabilityKey,
    );
    const dependsOn = parseBracketedList(
      fields.dependsOn,
      "dependsOn",
      capabilityKey,
    );

    entries.push({
      capabilityKey,
      name,
      description,
      category,
      source: fields.source,
      costPerCallUsd,
      costNote: fields.costNote,
      groupedWith,
      dependsOn,
      runFrequency,
      cached,
      importanceToRevenue,
    });
  }

  return entries;
}

function validateParity(entries, runtimeKeys) {
  const catalogKeys = new Set(entries.map((e) => e.capabilityKey));
  const missing = [...runtimeKeys].filter((k) => !catalogKeys.has(k));
  const extra = [...catalogKeys].filter((k) => !runtimeKeys.has(k));
  if (missing.length || extra.length) {
    throw new Error(
      `CAPABILITY_KEYS ↔ signal-catalog.md parity broken.\n` +
        `  missing in catalog: ${missing.join(", ") || "(none)"}\n` +
        `  extra in catalog:   ${extra.join(", ") || "(none)"}`,
    );
  }

  // groupedWith / dependsOn must reference real capability keys
  for (const e of entries) {
    for (const ref of [...e.groupedWith, ...e.dependsOn]) {
      if (!runtimeKeys.has(ref)) {
        throw new Error(`${e.capabilityKey} references unknown key: ${ref}`);
      }
    }
  }

  // `dependsOn` is hand-authored: it means "this module reads that capability's
  // snapshot/artifact", which only the module itself knows. It is NOT derivable
  // from `groupedWith` — that's a cost/thematic grouping. Deriving it would
  // fabricate edges. So we only check it can't corrupt the graph: no self-edges,
  // no duplicates. Referential integrity is checked above.
  for (const e of entries) {
    if (e.dependsOn.includes(e.capabilityKey)) {
      throw new Error(`${e.capabilityKey} dependsOn includes itself`);
    }
    if (new Set(e.dependsOn).size !== e.dependsOn.length) {
      throw new Error(
        `${e.capabilityKey} dependsOn has duplicates: [${e.dependsOn.join(", ")}]`,
      );
    }
  }
}

function emitListField(name, values) {
  if (values.length === 0) {
    return `    ${name}: [],`;
  }
  return `    ${name}: [${values.map((k) => `"${k}"`).join(", ")}],`;
}

function emit(entries, runtimeKeys) {
  const esc = (s) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const lines = [];
  lines.push("// AUTO-GENERATED FROM signal-catalog.md — DO NOT EDIT.");
  lines.push("// Edit the .md and run `bun run signals:gen` to regenerate.");
  lines.push("");
  lines.push('import type { CapabilityKey } from "@/server/db/schema";');
  lines.push("import type {");
  lines.push("  ImportanceToRevenue,");
  lines.push("  RunFrequency,");
  lines.push("  SignalSpec,");
  lines.push('} from "./signal-catalog";');
  lines.push("");
  lines.push("export const SIGNAL_CATALOG: SignalSpec[] = [");
  for (const e of entries) {
    lines.push("  {");
    lines.push(`    capabilityKey: "${e.capabilityKey}",`);
    lines.push(`    name: "${esc(e.name)}",`);
    lines.push(`    description: "${esc(e.description)}",`);
    lines.push(`    category: "${e.category}",`);
    lines.push(`    source: "${esc(e.source)}",`);
    lines.push(`    costPerCallUsd: ${e.costPerCallUsd},`);
    lines.push(`    costNote: "${esc(e.costNote)}",`);
    lines.push(emitListField("groupedWith", e.groupedWith));
    lines.push(emitListField("dependsOn", e.dependsOn));
    lines.push(`    runFrequency: "${e.runFrequency}" as RunFrequency,`);
    lines.push(`    cached: ${e.cached},`);
    lines.push(
      `    importanceToRevenue: "${e.importanceToRevenue}" as ImportanceToRevenue,`,
    );
    lines.push("  },");
  }
  lines.push("];");
  lines.push("");
  lines.push(
    "/** Upstream lineage edges: capability → direct producer keys (from catalog dependsOn). */",
  );
  lines.push(
    "export const SIGNAL_LINEAGE: Readonly<Record<CapabilityKey, readonly CapabilityKey[]>> = {",
  );
  const lineageByKey = new Map();
  for (const e of entries) {
    if (!lineageByKey.has(e.capabilityKey)) {
      lineageByKey.set(e.capabilityKey, e.dependsOn);
    }
  }
  for (const key of [...runtimeKeys].sort()) {
    const deps = lineageByKey.get(key) ?? [];
    if (deps.length === 0) {
      lines.push(`  ${key}: [],`);
    } else {
      lines.push(`  ${key}: [${deps.map((k) => `"${k}"`).join(", ")}],`);
    }
  }
  lines.push("} as const;");
  lines.push("");
  return lines.join("\n");
}

function main() {
  const check = argv.includes("--check");

  // Normalize CRLF -> LF up front so a checkout with Windows line endings
  // doesn't break the `\n`-anchored regexes in parseMarkdown.
  const md = readFileSync(MD_PATH, "utf8").replace(/\r\n/g, "\n");
  const runtimeKeys = loadRuntimeKeys();
  const entries = parseMarkdown(md);
  validateParity(entries, runtimeKeys);

  const generated = emit(entries, runtimeKeys);

  if (check) {
    let existing;
    try {
      existing = readFileSync(TS_PATH, "utf8");
    } catch {
      console.error(`✗ ${TS_PATH} missing — run \`bun run signals:gen\``);
      exit(1);
    }
    // Compare CRLF-normalized so a Windows checkout of the generated file
    // doesn't false-positive as "out of sync".
    if (existing.replace(/\r\n/g, "\n").trimEnd() !== generated.trimEnd()) {
      console.error(
        `✗ ${TS_PATH} is out of sync with ${MD_PATH}. Run \`bun run signals:gen\` and commit.`,
      );
      exit(1);
    }
    console.log(`✓ ${entries.length} signals parity OK.`);
    return;
  }

  writeFileSync(TS_PATH, generated);
  console.log(`✓ Wrote ${entries.length} signals to ${TS_PATH}`);
}

main();
