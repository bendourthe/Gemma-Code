/**
 * v1.2.0 Phase 4.3 -- one-way migration from `DenseIndex` to
 * `PrunedDenseIndex`.
 *
 * DEVIATION: The plan places the entry point at
 * `scripts/migrate-dense-index-to-pruned.ts`. The Nexus repo's `scripts/`
 * convention is `.mjs` files invoking compiled core code, and the tsconfig
 * explicitly excludes `scripts/` from compilation. To keep migration logic
 * testable in unit tests, the function lives here under `core/memory/`; the
 * CLI wrapper at `scripts/migrate-dense-index-to-pruned.mjs` just calls into
 * this module.
 *
 * Behaviour:
 *   * Reads the existing `DenseIndex` save file (entries with embeddings).
 *   * Asks the caller for the canonical chunk text per entryId (this is what
 *     lets the new pruned index recompute embeddings on demand). The caller
 *     supplies a `loadText(entryId)` callback typically backed by the
 *     SQLite-side memory store; passing `null` causes the entry to be
 *     dropped from the migrated index.
 *   * Builds a new `PrunedDenseIndex`, compacts it (which builds the kNN
 *     graph), and saves it next to the original.
 *   * Backs up the original under `<dir>/dense.backup-<timestamp>.bin` so a
 *     manual rollback is one move.
 *   * Idempotent: re-running on a directory that already has a pruned file
 *     and a backup is a no-op (returns `skipped: true`).
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { DenseIndex } from "./DenseIndex.js";
import { PrunedDenseIndex } from "./PrunedDenseIndex.js";
import type { Embedder } from "./LocalEmbedder.js";

export interface MigrateOptions {
  /** Path to the existing `DenseIndex` save file. */
  readonly densePath: string;
  /** Path where the new `PrunedDenseIndex` save file should land. */
  readonly prunedPath: string;
  /** Embedder for the new pruned index. Recomputes embeddings during compact. */
  readonly embedder: Embedder;
  /**
   * Resolve the canonical chunk text for an `entryId`. Implementations
   * typically wrap a `SELECT content FROM memory_entries WHERE id = ?` query.
   * Returning `null` causes the entry to be dropped (entry was deleted
   * concurrently or never had body text -- e.g. a tombstoned row).
   */
  readonly loadText: (entryId: string) => Promise<string | null> | string | null;
  /**
   * Override the timestamp used for the backup filename. Defaults to the
   * current ISO timestamp; tests pass a fixed value for determinism.
   */
  readonly timestamp?: string;
  /** When set, skip writing the backup. Defaults to `false`. */
  readonly skipBackup?: boolean;
  /** Optional progress callback fired after every 100 entries migrated. */
  readonly onProgress?: (info: { processed: number; total: number }) => void;
}

export interface MigrateResult {
  readonly skipped: boolean;
  readonly skipReason?: "already-migrated" | "no-input";
  readonly entriesMigrated: number;
  readonly entriesDropped: number;
  readonly backupPath: string | null;
  readonly prunedPath: string;
}

/**
 * Run the migration. The function is idempotent: a second invocation on the
 * same directory short-circuits with `{skipped: true, skipReason: "already-migrated"}`.
 */
export async function migrateDenseToPruned(
  opts: MigrateOptions,
): Promise<MigrateResult> {
  const {
    densePath,
    prunedPath,
    embedder,
    loadText,
    timestamp,
    skipBackup,
    onProgress,
  } = opts;

  // Idempotency: if the pruned file already exists, the migration ran already.
  try {
    await fs.access(prunedPath);
    return {
      skipped: true,
      skipReason: "already-migrated",
      entriesMigrated: 0,
      entriesDropped: 0,
      backupPath: null,
      prunedPath,
    };
  } catch {
    // Pruned file not present: proceed.
  }

  // Read the existing DenseIndex. `DenseIndex.load` returns an empty index
  // when the file is missing, so we check explicitly.
  try {
    await fs.access(densePath);
  } catch {
    return {
      skipped: true,
      skipReason: "no-input",
      entriesMigrated: 0,
      entriesDropped: 0,
      backupPath: null,
      prunedPath,
    };
  }

  const dense = await DenseIndex.load(densePath);
  const entryIds = dense.allEntryIds();
  const pruned = new PrunedDenseIndex(embedder);
  let migrated = 0;
  let dropped = 0;
  for (const entryId of entryIds) {
    const text = await loadText(entryId);
    if (text === null || text.length === 0) {
      dropped += 1;
      continue;
    }
    pruned.add(entryId, text);
    migrated += 1;
    if (onProgress && migrated % 100 === 0) {
      onProgress({ processed: migrated, total: entryIds.length });
    }
  }
  await pruned.compact();
  await pruned.save(prunedPath);

  let backupPath: string | null = null;
  if (!skipBackup) {
    const ts = (timestamp ?? new Date().toISOString()).replace(/[:.]/g, "-");
    const dir = path.dirname(densePath);
    const base = path.basename(densePath, path.extname(densePath));
    backupPath = path.join(dir, `${base}.backup-${ts}${path.extname(densePath)}`);
    await fs.copyFile(densePath, backupPath);
  }

  return {
    skipped: false,
    entriesMigrated: migrated,
    entriesDropped: dropped,
    backupPath,
    prunedPath,
  };
}
