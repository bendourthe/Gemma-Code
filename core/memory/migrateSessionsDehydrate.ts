/**
 * v1.6.0 Phase 3 (adoption-aisuite-harness A1 / AS005) -- one-way migration
 * that dehydrates an existing `sessions.json` file in place.
 *
 * DEVIATION (mirrors `migrateDenseToPruned`): the migration logic lives here
 * under `core/memory/` so it is unit-testable; the thin CLI runner at
 * `scripts/migrate-sessions-dehydrate.mjs` only parses argv and prints
 * progress. The repo's `scripts/` convention is `.mjs` wrappers over compiled
 * core code, and `tsconfig` excludes `scripts/` from compilation.
 *
 * Behaviour:
 *   - Reads the sessions file. Missing file -> `{skipped, no-input}`.
 *   - A file already at schema `version >= TARGET_VERSION` is a no-op
 *     (`already-migrated`), so re-runs are idempotent.
 *   - For each session, dehydrates `messages` larger than the threshold to the
 *     supplied {@link ArtifactStore} (redaction applied on that path), bumps
 *     the file `version`, and rewrites it.
 *   - Backs up the original to `<dir>/sessions.backup-<ts>.json` (unless
 *     `skipBackup`) so a manual rollback is one move.
 *   - Operates on the generic on-disk JSON shape (it only touches the
 *     `messages` array of each session and the top-level `version`), so it
 *     stays decoupled from the sidecar's exact `PersistedSession` type and
 *     preserves every other field verbatim.
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import type { ArtifactStore } from "./ArtifactStore.js";
import {
  DEFAULT_DEHYDRATION_THRESHOLD_BYTES,
  dehydrateMessages,
  isDehydratedArtifact,
  type PersistedMessage,
} from "./sessionArtifacts.js";

/** Schema version written by this migration. v1 = inline-only; v2 = dehydrated. */
export const TARGET_SCHEMA_VERSION = 2;

interface DiskSessionShape {
  readonly messages?: readonly PersistedMessage[];
  readonly [key: string]: unknown;
}

interface DiskSessionsFile {
  readonly version?: number;
  readonly sessions?: readonly DiskSessionShape[];
  readonly [key: string]: unknown;
}

export interface MigrateSessionsOptions {
  /** Path to the existing `sessions.json` file. */
  readonly sessionsPath: string;
  /** Artifact store that receives the dehydrated payloads. */
  readonly store: ArtifactStore;
  /** Byte threshold above which a message field is dehydrated. Defaults to 20KB. */
  readonly thresholdBytes?: number;
  /** Override the backup timestamp (tests pass a fixed value). */
  readonly timestamp?: string;
  /** Skip writing the backup file. Defaults to `false`. */
  readonly skipBackup?: boolean;
}

export interface MigrateSessionsResult {
  readonly skipped: boolean;
  readonly skipReason?: "no-input" | "already-migrated";
  readonly sessionsProcessed: number;
  readonly fieldsDehydrated: number;
  readonly bytesBefore: number;
  readonly bytesAfter: number;
  readonly backupPath: string | null;
}

function emptyResult(
  skipReason: MigrateSessionsResult["skipReason"],
): MigrateSessionsResult {
  return {
    skipped: true,
    skipReason,
    sessionsProcessed: 0,
    fieldsDehydrated: 0,
    bytesBefore: 0,
    bytesAfter: 0,
    backupPath: null,
  };
}

/**
 * Run the migration. Idempotent: a file already at the target schema version
 * short-circuits with `{skipped: true, skipReason: "already-migrated"}`.
 */
export async function migrateSessionsDehydrate(
  opts: MigrateSessionsOptions,
): Promise<MigrateSessionsResult> {
  const { sessionsPath, store, thresholdBytes, timestamp, skipBackup } = opts;
  const threshold = thresholdBytes ?? DEFAULT_DEHYDRATION_THRESHOLD_BYTES;

  let raw: string;
  try {
    raw = await fs.readFile(sessionsPath, "utf8");
  } catch {
    return emptyResult("no-input");
  }

  let parsed: DiskSessionsFile;
  try {
    parsed = JSON.parse(raw) as DiskSessionsFile;
  } catch {
    // A corrupt file is not something this migration should silently rewrite.
    return emptyResult("no-input");
  }

  if (!parsed || !Array.isArray(parsed.sessions)) {
    return emptyResult("no-input");
  }
  if (typeof parsed.version === "number" && parsed.version >= TARGET_SCHEMA_VERSION) {
    return emptyResult("already-migrated");
  }

  const bytesBefore = Buffer.byteLength(raw, "utf8");

  let fieldsDehydrated = 0;
  const migratedSessions = parsed.sessions.map((session) => {
    const messages = Array.isArray(session.messages) ? session.messages : [];
    const dehydrated = dehydrateMessages(messages, store, { thresholdBytes: threshold });
    for (let i = 0; i < dehydrated.length; i += 1) {
      const after = dehydrated[i];
      const before = messages[i];
      if (isDehydratedArtifact(after) && !isDehydratedArtifact(before)) {
        fieldsDehydrated += 1;
      }
    }
    return { ...session, messages: dehydrated };
  });

  const migratedFile: DiskSessionsFile = {
    ...parsed,
    version: TARGET_SCHEMA_VERSION,
    sessions: migratedSessions,
  };
  const serialized = `${JSON.stringify(migratedFile, null, 2)}`;
  const bytesAfter = Buffer.byteLength(serialized, "utf8");

  let backupPath: string | null = null;
  if (!skipBackup) {
    const ts = (timestamp ?? new Date().toISOString()).replace(/[:.]/g, "-");
    const dir = path.dirname(sessionsPath);
    const base = path.basename(sessionsPath, path.extname(sessionsPath));
    backupPath = path.join(dir, `${base}.backup-${ts}${path.extname(sessionsPath)}`);
    await fs.copyFile(sessionsPath, backupPath);
  }

  const tmp = `${sessionsPath}.migrate-tmp`;
  await fs.writeFile(tmp, serialized, "utf8");
  await fs.rename(tmp, sessionsPath);

  return {
    skipped: false,
    sessionsProcessed: migratedSessions.length,
    fieldsDehydrated,
    bytesBefore,
    bytesAfter,
    backupPath,
  };
}
