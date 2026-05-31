#!/usr/bin/env node
/**
 * v1.4.0 Phase 7 (T020) -- one-shot, fully path-aware codemod for the
 * wholesale `src/<tree>` -> `modules/coding/<tree>` move of the 12 remaining
 * sub-trees tracked by known-gap 1.4.P1.B.
 *
 * Unlike scripts/dev/rewrite-imports.mjs (which only re-points EXTERNAL
 * importers at moved targets, leaving the moved files' own outbound imports
 * stale), this codemod recomputes EVERY relative specifier in EVERY scanned
 * file from that file's POST-move location, mapping both the importing file
 * and the import target through the move set. It therefore also fixes:
 *   - moved files' imports to `core/**` and unmoved `src/**` (depth changes),
 *   - moved files' imports to the already-moved `modules/coding/utils`,
 *   - nested sub-dirs (chat/, skills/) whose depth shifts non-uniformly.
 *
 * Run BEFORE `git mv`: it rewrites files in place at their CURRENT (old)
 * locations so that, once the directories are renamed, every relative import
 * already resolves correctly. Idempotent (re-running after the git mv is a
 * no-op because specifiers already match their post-move form).
 *
 *   node scripts/dev/move-coding-subtrees.mjs [--dry-run]
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..", "..");

// The 12 sub-trees from plan T020. `src/llm` MERGES into the existing
// `modules/coding/llm` (which already holds PromptFormat.ts / ToolCallFormat.ts).
const MOVES = [
  "config",
  "llm",
  "observability",
  "orchestration",
  "guardrails",
  "mcp",
  "commands",
  "agents",
  "chat",
  "evaluation",
  "skills",
  "runtime",
].map((name) => ({
  fromAbs: toPosix(resolve(REPO_ROOT, "src", name)),
  toAbs: toPosix(resolve(REPO_ROOT, "modules", "coding", name)),
}));

const SCAN_ROOTS = ["src", "core", "modules", "tests"];
const SKIP_DIR_NAMES = new Set(["node_modules", "out", ".git", "coverage", "dist"]);
const SCAN_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts"]);

const SPECIFIER_PATTERNS = [
  /(\b(?:import|export)\b[^;'"`]*?\bfrom\s*)(["'])([^"']+)\2/g,
  /(\bimport\s*)(["'])([^"']+)\2/g,
  /(\bimport\s*\(\s*)(["'])([^"']+)\2(\s*\))/g,
  /(\bvi\.(?:mock|doMock|hoisted)\s*\(\s*)(["'])([^"']+)\2/g,
];

function toPosix(p) {
  return p.split(/[\\/]/).join("/");
}

/** Map an absolute POSIX path through the move set (file dir or import target). */
function mapPath(absPosix) {
  for (const m of MOVES) {
    if (absPosix === m.fromAbs) return m.toAbs;
    if (absPosix.startsWith(m.fromAbs + "/")) {
      return m.toAbs + absPosix.slice(m.fromAbs.length);
    }
  }
  return absPosix;
}

function walk(root) {
  const out = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = readdirSync(current);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (SKIP_DIR_NAMES.has(name)) continue;
      const full = join(current, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        stack.push(full);
      } else if (st.isFile()) {
        const dot = name.lastIndexOf(".");
        if (dot < 0) continue;
        if (name.endsWith(".d.ts")) continue;
        if (SCAN_EXTENSIONS.has(name.slice(dot))) out.push(full);
      }
    }
  }
  return out;
}

function rewriteSpecifier(origDirAbs, newDirAbs, specifier) {
  if (!specifier.startsWith(".") && !specifier.startsWith("/")) return null;
  const extMatch = specifier.match(/\.(js|mjs|cjs|ts|tsx|cts|mts)$/);
  const suffix = extMatch ? extMatch[0] : "";
  const stem = suffix ? specifier.slice(0, -suffix.length) : specifier;
  const origTargetAbs = toPosix(resolve(origDirAbs, stem));
  const newTargetAbs = mapPath(origTargetAbs);
  let rel = toPosix(relative(newDirAbs, newTargetAbs));
  if (!rel.startsWith(".")) rel = "./" + rel;
  const next = rel + suffix;
  return next === specifier ? null : next;
}

function rewriteFile(filePath, dryRun) {
  const original = readFileSync(filePath, "utf-8");
  const origDirAbs = toPosix(dirname(filePath));
  const newDirAbs = mapPath(origDirAbs);
  let updated = original;
  let changed = false;
  for (const pattern of SPECIFIER_PATTERNS) {
    updated = updated.replace(pattern, (match, prefix, quote, spec, suffix) => {
      const next = rewriteSpecifier(origDirAbs, newDirAbs, spec);
      if (next === null) return match;
      changed = true;
      return `${prefix}${quote}${next}${quote}${typeof suffix === "string" ? suffix : ""}`;
    });
  }
  if (changed && !dryRun) writeFileSync(filePath, updated, "utf-8");
  return changed;
}

function main() {
  const dryRun = process.argv.includes("--dry-run");
  let scanned = 0;
  let touched = 0;
  for (const rootName of SCAN_ROOTS) {
    const rootDir = join(REPO_ROOT, rootName);
    try {
      if (!statSync(rootDir).isDirectory()) continue;
    } catch {
      continue;
    }
    for (const file of walk(rootDir)) {
      scanned += 1;
      if (rewriteFile(file, dryRun)) {
        touched += 1;
        console.log(`  ${dryRun ? "would update" : "updated"}  ${toPosix(relative(REPO_ROOT, file))}`);
      }
    }
  }
  console.log(`\nScanned ${scanned} files; ${touched} ${dryRun ? "would change" : "rewritten"}.`);
}

main();
