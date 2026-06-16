#!/usr/bin/env node
/**
 * v1.6.0 Phase 3 (adoption-aisuite-harness A1 / AS005) -- CLI wrapper for the
 * one-way `sessions.json` dehydration migration. Run after a successful
 * `npm run build` so the compiled output under `out/core/memory/` is
 * available.
 *
 * Usage:
 *   node scripts/migrate-sessions-dehydrate.mjs \
 *     --sessions ~/.nexus/sessions.json \
 *     [--artifacts ~/.nexus/session-artifacts] \
 *     [--threshold 20480] \
 *     [--skip-backup]
 *
 * `--artifacts` defaults to a `session-artifacts` directory next to the
 * sessions file, which is exactly where `JsonFileSessionStore` looks at
 * runtime, so a migrated file resolves its refs without further configuration.
 *
 * The migration logic itself lives in `core/memory/migrateSessionsDehydrate.ts`
 * (unit-tested); this wrapper only parses argv and prints a summary. It stays
 * `.mjs` for the same reason `migrate-dense-index-to-pruned.mjs` does: no
 * scripts-wide tsconfig exists and the typed surface is already the
 * unit-tested core module.
 */

import * as path from "node:path";
import { ArtifactStore } from "../out/core/memory/ArtifactStore.js";
import { migrateSessionsDehydrate } from "../out/core/memory/migrateSessionsDehydrate.js";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--sessions") args.sessions = argv[++i];
    else if (a === "--artifacts") args.artifacts = argv[++i];
    else if (a === "--threshold") args.threshold = Number(argv[++i]);
    else if (a === "--skip-backup") args.skipBackup = true;
    else if (a === "--help" || a === "-h") args.help = true;
  }
  return args;
}

function usage() {
  console.log(
    "Usage: node scripts/migrate-sessions-dehydrate.mjs --sessions <path> " +
      "[--artifacts <dir>] [--threshold <bytes>] [--skip-backup]",
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.sessions) {
    usage();
    process.exit(args.help ? 0 : 1);
  }

  const artifactsDir =
    args.artifacts ?? path.join(path.dirname(args.sessions), "session-artifacts");
  const store = new ArtifactStore(artifactsDir);

  const result = await migrateSessionsDehydrate({
    sessionsPath: args.sessions,
    store,
    thresholdBytes: Number.isFinite(args.threshold) ? args.threshold : undefined,
    skipBackup: args.skipBackup === true,
  });

  if (result.skipped) {
    console.log(`Migration skipped: ${result.skipReason}`);
    return;
  }
  const pct =
    result.bytesBefore > 0
      ? ((1 - result.bytesAfter / result.bytesBefore) * 100).toFixed(1)
      : "0.0";
  console.log(
    `Migrated ${result.sessionsProcessed} session(s); dehydrated ` +
      `${result.fieldsDehydrated} field(s); ${result.bytesBefore} -> ` +
      `${result.bytesAfter} bytes (${pct}% smaller).`,
  );
  if (result.backupPath) console.log(`Backup: ${result.backupPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
