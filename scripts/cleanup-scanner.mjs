#!/usr/bin/env node
// v0.8.0 Phase 2 (item C3) -- cleanup scanner for end-of-session hygiene.
//
// Surfaces a small set of orphan artifacts that the clean-state checklist
// would otherwise have to inspect by hand:
//
//   * Orphan memory rows whose sessionId is gone from ChatHistoryStore.
//   * Orphan FTS5 rows pointing at deleted memories.
//   * Dangling embeddings (zero-vector or non-finite values).
//   * Memory.md / Context.md references to deleted file paths.
//   * Stale `.gemma-code/cache/*` files older than 30 days.
//
// Node-only, zero dependencies. The scanner is best-effort and read-only
// -- it never mutates the database or files on disk.
//
// Usage:
//   node scripts/cleanup-scanner.mjs                       # human-readable
//   node scripts/cleanup-scanner.mjs --format=json         # JSON dump
//   node scripts/cleanup-scanner.mjs --workspace <path>    # alternative workspace
//   node scripts/cleanup-scanner.mjs --memory-dir <path>   # alternative memory base

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const STALE_CACHE_DAYS = 30;
const STALE_CACHE_MS = STALE_CACHE_DAYS * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = { format: "text", workspace: process.cwd(), memoryDir: null };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--format" && argv[i + 1]) {
      out.format = argv[++i];
    } else if (arg.startsWith("--format=")) {
      out.format = arg.slice("--format=".length);
    } else if (arg === "--workspace" && argv[i + 1]) {
      out.workspace = path.resolve(argv[++i]);
    } else if (arg === "--memory-dir" && argv[i + 1]) {
      out.memoryDir = path.resolve(argv[++i]);
    } else if (arg === "-h" || arg === "--help") {
      printUsage();
      process.exit(0);
    }
  }
  if (out.format !== "text" && out.format !== "json") {
    process.stderr.write(`[cleanup-scanner] unknown --format=${out.format}; expected "text" or "json"\n`);
    process.exit(2);
  }
  return out;
}

function printUsage() {
  process.stdout.write(
    [
      "Usage: node scripts/cleanup-scanner.mjs [options]",
      "",
      "Options:",
      "  --format <text|json>   Output format (default: text).",
      "  --workspace <path>     Workspace root to scan (default: cwd).",
      "  --memory-dir <path>    Memory base dir (default: ~/.gemma-code/memory).",
      "  -h, --help             Show this help.",
      "",
    ].join("\n"),
  );
}

// ---------------------------------------------------------------------------
// Scanners
// ---------------------------------------------------------------------------

function scanStaleCacheFiles(workspace) {
  const findings = [];
  const cacheDir = path.join(workspace, ".gemma-code", "cache");
  if (!fs.existsSync(cacheDir)) return findings;

  const cutoff = Date.now() - STALE_CACHE_MS;
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
        continue;
      }
      try {
        const stat = fs.statSync(abs);
        if (stat.mtimeMs < cutoff) {
          findings.push({
            kind: "stale-cache-file",
            path: path.relative(workspace, abs),
            mtime: new Date(stat.mtimeMs).toISOString(),
            ageDays: Math.floor((Date.now() - stat.mtimeMs) / (24 * 60 * 60 * 1000)),
          });
        }
      } catch {
        // skip files we cannot stat
      }
    }
  };
  walk(cacheDir);
  return findings;
}

function scanDeletedPathReferences(workspace, memoryDir) {
  const findings = [];
  if (!fs.existsSync(memoryDir)) return findings;

  let workspaceDirs;
  try {
    workspaceDirs = fs.readdirSync(memoryDir, { withFileTypes: true });
  } catch {
    return findings;
  }

  // Heuristic: scan Memory.md + Context.md for tokens that look like a
  // workspace-relative path (e.g. `src/foo/bar.ts`) and report when no
  // such file exists.
  const PATH_TOKEN_RE = /(?:\b|[\s`'"])((?:src|tests|scripts|docs|bin|assets)\/[A-Za-z0-9._\-/]+\.(?:ts|js|mjs|cjs|md|json|yml|yaml|sh|ps1))/g;

  for (const ws of workspaceDirs) {
    if (!ws.isDirectory()) continue;
    for (const file of ["Memory.md", "Context.md"]) {
      const target = path.join(memoryDir, ws.name, file);
      let content;
      try {
        content = fs.readFileSync(target, "utf8");
      } catch {
        continue;
      }
      const seen = new Set();
      let m;
      PATH_TOKEN_RE.lastIndex = 0;
      while ((m = PATH_TOKEN_RE.exec(content)) !== null) {
        const candidate = m[1];
        if (!candidate || seen.has(candidate)) continue;
        seen.add(candidate);
        const abs = path.join(workspace, candidate);
        if (!fs.existsSync(abs)) {
          findings.push({
            kind: "deleted-path-reference",
            file: `${ws.name}/${file}`,
            referencedPath: candidate,
          });
        }
      }
    }
  }
  return findings;
}

function scanDatabaseOrphans(workspace) {
  // The MemoryStore / ChatHistoryStore SQLite databases live in the
  // workspace-local `.gemma-code/` cache when present. We use better-sqlite3
  // from the project's own node_modules so the scanner stays zero-dependency
  // outside of the repo's existing tree.
  const dbCandidates = [
    path.join(workspace, ".gemma-code", "memory.db"),
    path.join(workspace, ".gemma-code", "memories.db"),
  ];
  const dbPath = dbCandidates.find((p) => fs.existsSync(p));
  if (!dbPath) {
    return { findings: [], note: "no MemoryStore database found at .gemma-code/memory.db; skipping DB checks" };
  }

  let Database;
  try {
    Database = require("better-sqlite3");
  } catch {
    return { findings: [], note: `better-sqlite3 not available; skipping DB checks for ${dbPath}` };
  }

  const findings = [];
  let db;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
  } catch (err) {
    return { findings, note: `failed to open ${dbPath} read-only: ${err.message}` };
  }

  try {
    const tableNames = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table'`)
      .all()
      .map((r) => r.name);

    // Orphan memory rows -- sessionId set but no matching chat session.
    if (tableNames.includes("memories") && tableNames.includes("chat_sessions")) {
      const rows = db
        .prepare(
          `SELECT m.id, m.session_id FROM memories m
           LEFT JOIN chat_sessions s ON s.id = m.session_id
           WHERE m.session_id IS NOT NULL AND s.id IS NULL`,
        )
        .all();
      for (const r of rows) {
        findings.push({ kind: "orphan-memory-row", id: r.id, sessionId: r.session_id });
      }
    }

    // Orphan FTS5 rows -- index entry without a matching memories row.
    if (tableNames.includes("memories_fts")) {
      const rows = db
        .prepare(
          `SELECT fts.rowid FROM memories_fts fts
           LEFT JOIN memories m ON m.rowid = fts.rowid
           WHERE m.rowid IS NULL`,
        )
        .all();
      for (const r of rows) {
        findings.push({ kind: "orphan-fts-row", rowid: r.rowid });
      }
    }

    // Dangling embeddings -- non-null embedding blob that decodes to a
    // zero-vector or contains a non-finite float. We sample at most 1000
    // rows so the scan stays fast on large stores.
    if (tableNames.includes("memories")) {
      const rows = db
        .prepare(`SELECT id, embedding FROM memories WHERE embedding IS NOT NULL LIMIT 1000`)
        .all();
      for (const r of rows) {
        if (!(r.embedding instanceof Buffer)) continue;
        if (r.embedding.length === 0 || r.embedding.length % 4 !== 0) {
          findings.push({ kind: "dangling-embedding", id: r.id, reason: "invalid blob length" });
          continue;
        }
        const view = new Float32Array(
          r.embedding.buffer,
          r.embedding.byteOffset,
          r.embedding.length / 4,
        );
        let allZero = true;
        let badFloat = false;
        for (let i = 0; i < view.length; i++) {
          const v = view[i];
          if (v !== 0) allZero = false;
          if (!Number.isFinite(v)) {
            badFloat = true;
            break;
          }
        }
        if (badFloat) {
          findings.push({ kind: "dangling-embedding", id: r.id, reason: "NaN/Inf component" });
        } else if (allZero) {
          findings.push({ kind: "dangling-embedding", id: r.id, reason: "all-zero vector" });
        }
      }
    }
  } finally {
    db.close();
  }

  return { findings };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const args = parseArgs(process.argv);
  const memoryDir = args.memoryDir ?? path.join(os.homedir(), ".gemma-code", "memory");

  const report = {
    scannedAt: new Date().toISOString(),
    workspace: args.workspace,
    memoryDir,
    notes: [],
    findings: {
      staleCacheFiles: scanStaleCacheFiles(args.workspace),
      deletedPathReferences: scanDeletedPathReferences(args.workspace, memoryDir),
    },
  };

  const dbResult = scanDatabaseOrphans(args.workspace);
  if (dbResult.note) report.notes.push(dbResult.note);
  const orphanMemories = dbResult.findings.filter((f) => f.kind === "orphan-memory-row");
  const orphanFts = dbResult.findings.filter((f) => f.kind === "orphan-fts-row");
  const danglingEmbeddings = dbResult.findings.filter((f) => f.kind === "dangling-embedding");
  report.findings.orphanMemoryRows = orphanMemories;
  report.findings.orphanFtsRows = orphanFts;
  report.findings.danglingEmbeddings = danglingEmbeddings;

  const totalCount =
    report.findings.staleCacheFiles.length +
    report.findings.deletedPathReferences.length +
    orphanMemories.length +
    orphanFts.length +
    danglingEmbeddings.length;

  report.summary = { totalFindings: totalCount };

  if (args.format === "json") {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } else {
    process.stdout.write(formatText(report) + "\n");
  }

  process.exit(0);
}

function formatText(report) {
  const lines = [];
  lines.push(`[cleanup-scanner] scanned ${report.workspace} at ${report.scannedAt}`);
  for (const note of report.notes) {
    lines.push(`  note: ${note}`);
  }
  const f = report.findings;
  lines.push("");
  lines.push(`  stale-cache-files:         ${f.staleCacheFiles.length}`);
  lines.push(`  deleted-path-references:   ${f.deletedPathReferences.length}`);
  lines.push(`  orphan-memory-rows:        ${f.orphanMemoryRows.length}`);
  lines.push(`  orphan-fts-rows:           ${f.orphanFtsRows.length}`);
  lines.push(`  dangling-embeddings:       ${f.danglingEmbeddings.length}`);
  lines.push("");
  lines.push(`Total findings: ${report.summary.totalFindings}`);
  return lines.join("\n");
}

main();
