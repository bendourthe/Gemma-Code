#!/usr/bin/env node
/**
 * v1.2.0 Phase 4.3 -- CLI wrapper for the DenseIndex -> PrunedDenseIndex
 * migration. Run after a successful `npm run build` so the compiled output
 * under `out/core/memory/` is available.
 *
 * Usage:
 *   node scripts/migrate-dense-index-to-pruned.mjs \
 *     --dense ~/.nexus/memory/dense.bin \
 *     --pruned ~/.nexus/memory/dense-pruned.bin \
 *     --texts ~/.nexus/memory/chunk-texts.jsonl
 *
 * The `--texts` argument points at a JSONL file with `{"id": "...", "text": "..."}`
 * rows -- typically dumped from the SQLite memory store before invoking
 * this script. Missing texts cause the corresponding entry to be dropped.
 *
 * The migration logic itself lives in `core/memory/migrateDenseToPruned.ts`
 * so it can be unit-tested. This wrapper only parses argv and prints
 * progress.
 *
 * v1.4.0 Phase 8 (gap 4.3.P3.M, CLOSED keep-.mjs): the gap proposed renaming
 * this wrapper to `.ts` once a `tsconfig.scripts.json` lands. No scripts
 * tsconfig exists, and the only typed surface (the migration algorithm) is
 * already the unit-tested `core/memory/migrateDenseToPruned.ts`. This file is
 * a thin argv/print runner with no logic worth type-checking, so it stays
 * `.mjs`. Reopen if a scripts-wide tsconfig is introduced.
 */

import { promises as fs } from "node:fs";
import { migrateDenseToPruned } from "../out/core/memory/migrateDenseToPruned.js";
import { LocalEmbedder } from "../out/core/memory/LocalEmbedder.js";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--dense") args.dense = argv[++i];
    else if (a === "--pruned") args.pruned = argv[++i];
    else if (a === "--texts") args.texts = argv[++i];
    else if (a === "--skip-backup") args.skipBackup = true;
    else if (a === "--help" || a === "-h") args.help = true;
  }
  return args;
}

function usage() {
  console.log(
    "Usage: node scripts/migrate-dense-index-to-pruned.mjs --dense <path> --pruned <path> --texts <jsonl>",
  );
}

async function loadTextMap(jsonlPath) {
  if (!jsonlPath) return new Map();
  const raw = await fs.readFile(jsonlPath, "utf-8");
  const map = new Map();
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    try {
      const row = JSON.parse(trimmed);
      if (row && typeof row.id === "string" && typeof row.text === "string") {
        map.set(row.id, row.text);
      }
    } catch {
      // Skip malformed lines; the migration treats missing entries as drops.
    }
  }
  return map;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.dense || !args.pruned) {
    usage();
    process.exit(args.help ? 0 : 1);
  }

  const textMap = await loadTextMap(args.texts);
  const result = await migrateDenseToPruned({
    densePath: args.dense,
    prunedPath: args.pruned,
    embedder: new LocalEmbedder({ forceFallback: false }),
    loadText: (id) => textMap.get(id) ?? null,
    skipBackup: Boolean(args.skipBackup),
    onProgress: ({ processed, total }) => {
      const pct = total > 0 ? Math.round((processed / total) * 100) : 0;
      console.log(`migrating ${processed}/${total} (${pct}%)`);
    },
  });

  if (result.skipped) {
    console.log(`Migration skipped: ${result.skipReason ?? "unknown"}`);
  } else {
    console.log(
      `Migration complete: ${result.entriesMigrated} migrated, ${result.entriesDropped} dropped, backup=${result.backupPath ?? "<skipped>"}`,
    );
  }
}

main().catch((err) => {
  console.error(`Migration failed: ${err?.stack ?? String(err)}`);
  process.exit(1);
});
