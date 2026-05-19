#!/usr/bin/env node
/**
 * v1.1.0 Phase 3 sub-task 3.1 -- import-rewriting codemod for the
 * `src/` -> `modules/coding/` sub-tree migration.
 *
 * Walks every TypeScript file under `src/`, `core/`, `modules/`, and `tests/`
 * and rewrites any import / re-export / dynamic-import / `vi.mock` /
 * `vi.doMock` specifier whose resolved absolute path lands inside one of the
 * directories named in the `--moves` manifest.
 *
 * The default manifest is the Phase 3 move:
 *
 *   [{ "from": "src/utils", "to": "modules/coding/utils" }]
 *
 * Pass `--moves <path>` to use a custom JSON manifest (an array of
 * { "from": "<old-rel-dir>", "to": "<new-rel-dir>" } entries).
 *
 * Pass `--dry-run` to print the list of files the script *would* touch
 * without writing any of them.
 *
 * The script is idempotent: re-running it after a successful rewrite is a
 * no-op (zero file writes). Path comparisons normalize to POSIX-style forward
 * slashes regardless of host OS, and emitted specifiers always use forward
 * slashes so the diff is identical on Windows / macOS / Linux.
 *
 * Run via:
 *   node scripts/dev/rewrite-imports.mjs
 *   node scripts/dev/rewrite-imports.mjs --dry-run
 *   node scripts/dev/rewrite-imports.mjs --moves path/to/manifest.json
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve, relative, posix } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..", "..");

const DEFAULT_MOVES = [
  { from: "src/utils", to: "modules/coding/utils" },
];

const SCAN_ROOTS = ["src", "core", "modules", "tests"];
const SKIP_DIR_NAMES = new Set([
  "node_modules",
  "out",
  ".git",
  "coverage",
  "dist",
]);
const SCAN_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts"]);

const SPECIFIER_PATTERNS = [
  // Static import / re-export with a from clause:
  //   import foo from "X";
  //   import * as foo from "X";
  //   import { a, b } from "X";
  //   import type { a } from "X";
  //   export { a } from "X";
  //   export * from "X";
  //   export type { a } from "X";
  /(\b(?:import|export)\b[^;'"`]*?\bfrom\s*)(["'])([^"']+)\2/g,
  // Bare side-effect import: `import "X";`
  /(\bimport\s*)(["'])([^"']+)\2/g,
  // Dynamic import: `import("X")`
  /(\bimport\s*\(\s*)(["'])([^"']+)\2(\s*\))/g,
  // Vitest mock helpers: `vi.mock("X", ...)` / `vi.doMock("X", ...)`
  /(\bvi\.(?:mock|doMock|hoisted)\s*\(\s*)(["'])([^"']+)\2/g,
];

function parseArgs(argv) {
  const args = { dryRun: false, movesPath: null };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--moves") {
      args.movesPath = argv[i + 1];
      i += 1;
    } else if (arg === "--help" || arg === "-h") {
      console.log("Usage: rewrite-imports.mjs [--dry-run] [--moves manifest.json]");
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(2);
    }
  }
  return args;
}

function loadMoves(movesPath) {
  if (!movesPath) return DEFAULT_MOVES;
  const raw = readFileSync(resolve(REPO_ROOT, movesPath), "utf-8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(`Manifest at ${movesPath} must be a JSON array.`);
  }
  for (const entry of parsed) {
    if (
      typeof entry !== "object" ||
      entry === null ||
      typeof entry.from !== "string" ||
      typeof entry.to !== "string"
    ) {
      throw new Error(
        `Manifest entries must be { from: string, to: string }; got ${JSON.stringify(entry)}`,
      );
    }
  }
  return parsed;
}

function toPosix(p) {
  return p.split(/[\\/]/).join("/");
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
        const ext = name.slice(dot);
        if (!SCAN_EXTENSIONS.has(ext)) continue;
        if (name.endsWith(".d.ts")) continue;
        out.push(full);
      }
    }
  }
  return out;
}

function buildMoveIndex(moves) {
  return moves.map((m) => {
    const fromAbs = toPosix(resolve(REPO_ROOT, m.from));
    const toAbs = toPosix(resolve(REPO_ROOT, m.to));
    return { fromAbs, toAbs, fromRel: m.from, toRel: m.to };
  });
}

function rewriteSpecifier(importerDirAbs, specifier, moves) {
  if (!specifier.startsWith(".") && !specifier.startsWith("/")) {
    // Bare module specifier (e.g. "node:fs", "vscode", "marked"). Skip.
    return null;
  }
  // Strip any trailing ".js" / ".ts" / ".mjs" / ".cjs" / ".tsx" so the
  // comparison is extension-agnostic. We restore the original suffix on the
  // way out.
  const extMatch = specifier.match(/\.(js|mjs|cjs|ts|tsx|cts|mts)$/);
  const suffix = extMatch ? extMatch[0] : "";
  const stem = suffix ? specifier.slice(0, -suffix.length) : specifier;
  const resolvedAbs = toPosix(resolve(importerDirAbs, stem));
  for (const move of moves) {
    if (
      resolvedAbs === move.fromAbs ||
      resolvedAbs.startsWith(move.fromAbs + "/")
    ) {
      const tail = resolvedAbs.slice(move.fromAbs.length);
      const newAbs = move.toAbs + tail;
      let rel = toPosix(relative(importerDirAbs, newAbs));
      if (!rel.startsWith(".")) rel = "./" + rel;
      return rel + suffix;
    }
  }
  return null;
}

function rewriteFile(filePath, moves, options) {
  const original = readFileSync(filePath, "utf-8");
  const importerDirAbs = toPosix(dirname(filePath));
  let updated = original;
  let changed = false;
  for (const pattern of SPECIFIER_PATTERNS) {
    updated = updated.replace(pattern, (match, prefix, quote, spec, suffix) => {
      const next = rewriteSpecifier(importerDirAbs, spec, moves);
      if (next === null || next === spec) return match;
      changed = true;
      const tail = typeof suffix === "string" ? suffix : "";
      return `${prefix}${quote}${next}${quote}${tail}`;
    });
  }
  if (!changed) return false;
  if (!options.dryRun) {
    writeFileSync(filePath, updated, "utf-8");
  }
  return true;
}

function main() {
  const args = parseArgs(process.argv);
  const moves = loadMoves(args.movesPath);
  const moveIndex = buildMoveIndex(moves);

  console.log(`Moves manifest (${moves.length} entries):`);
  for (const move of moves) {
    console.log(`  ${move.from} -> ${move.to}`);
  }
  if (args.dryRun) {
    console.log("\n[dry-run] No files will be written.");
  }
  console.log("");

  let scanned = 0;
  let touched = 0;
  for (const rootName of SCAN_ROOTS) {
    const rootDir = join(REPO_ROOT, rootName);
    try {
      const st = statSync(rootDir);
      if (!st.isDirectory()) continue;
    } catch {
      continue;
    }
    const files = walk(rootDir);
    for (const file of files) {
      scanned += 1;
      const didChange = rewriteFile(file, moveIndex, { dryRun: args.dryRun });
      if (didChange) {
        touched += 1;
        const rel = toPosix(relative(REPO_ROOT, file));
        console.log(`  ${args.dryRun ? "would update" : "updated"}  ${rel}`);
      }
    }
  }
  console.log("");
  console.log(`Scanned ${scanned} files; ${touched} ${args.dryRun ? "would change" : "rewritten"}.`);
}

main();
