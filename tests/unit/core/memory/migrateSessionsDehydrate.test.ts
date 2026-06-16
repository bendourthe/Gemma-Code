/**
 * v1.6.0 Phase 3 (adoption-aisuite-harness A1 / AS005) -- sessions.json
 * dehydration migration unit tests.
 *
 * Coverage:
 *   - migrates a v1 file: large fields dehydrated, version bumped, size shrinks
 *   - backup created; skipBackup honored
 *   - idempotent: a v2 file is a no-op (already-migrated)
 *   - no-input when the file is missing or corrupt
 *   - non-message fields preserved verbatim
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ArtifactStore } from "../../../../core/memory/ArtifactStore.js";
import { isDehydratedArtifact } from "../../../../core/memory/sessionArtifacts.js";
import {
  TARGET_SCHEMA_VERSION,
  migrateSessionsDehydrate,
} from "../../../../core/memory/migrateSessionsDehydrate.js";

let tmpDir = "";
beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-migrate-sessions-"));
});
afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

const big = "Q".repeat(40_000);

async function writeV1File(sessions: unknown[]): Promise<string> {
  const p = path.join(tmpDir, "sessions.json");
  await fs.writeFile(p, JSON.stringify({ version: 1, sessions }, null, 2), "utf8");
  return p;
}

describe("migrateSessionsDehydrate", () => {
  it("dehydrates large fields, bumps the version, and shrinks the file", async () => {
    const sessionsPath = await writeV1File([
      { id: "a", title: "T", messages: ["small", big] },
    ]);
    const store = new ArtifactStore(path.join(tmpDir, "session-artifacts"));
    const result = await migrateSessionsDehydrate({
      sessionsPath,
      store,
      timestamp: "2026-06-15T00-00-00",
    });

    expect(result.skipped).toBe(false);
    expect(result.sessionsProcessed).toBe(1);
    expect(result.fieldsDehydrated).toBe(1);
    expect(result.bytesAfter).toBeLessThan(result.bytesBefore);

    const migrated = JSON.parse(await fs.readFile(sessionsPath, "utf8"));
    expect(migrated.version).toBe(TARGET_SCHEMA_VERSION);
    expect(migrated.sessions[0].messages[0]).toBe("small");
    expect(isDehydratedArtifact(migrated.sessions[0].messages[1])).toBe(true);
  });

  it("creates a backup file unless skipBackup is set", async () => {
    const sessionsPath = await writeV1File([{ id: "a", messages: [big] }]);
    const store = new ArtifactStore(path.join(tmpDir, "session-artifacts"));
    const withBackup = await migrateSessionsDehydrate({
      sessionsPath,
      store,
      timestamp: "2026-06-15",
    });
    expect(withBackup.backupPath).toContain("backup-2026-06-15");
    expect(withBackup.backupPath).not.toBeNull();
    const stat = await fs.stat(withBackup.backupPath!);
    expect(stat.size).toBeGreaterThan(0);
  });

  it("omits the backup when skipBackup is true", async () => {
    const sessionsPath = await writeV1File([{ id: "a", messages: [big] }]);
    const store = new ArtifactStore(path.join(tmpDir, "session-artifacts"));
    const result = await migrateSessionsDehydrate({
      sessionsPath,
      store,
      skipBackup: true,
    });
    expect(result.backupPath).toBeNull();
  });

  it("is idempotent: a v2 file is already-migrated", async () => {
    const sessionsPath = await writeV1File([{ id: "a", messages: [big] }]);
    const store = new ArtifactStore(path.join(tmpDir, "session-artifacts"));
    await migrateSessionsDehydrate({ sessionsPath, store, skipBackup: true });
    const second = await migrateSessionsDehydrate({ sessionsPath, store, skipBackup: true });
    expect(second.skipped).toBe(true);
    expect(second.skipReason).toBe("already-migrated");
  });

  it("returns no-input when the file is missing", async () => {
    const store = new ArtifactStore(path.join(tmpDir, "session-artifacts"));
    const result = await migrateSessionsDehydrate({
      sessionsPath: path.join(tmpDir, "absent.json"),
      store,
    });
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe("no-input");
  });

  it("returns no-input when the file is corrupt", async () => {
    const p = path.join(tmpDir, "sessions.json");
    await fs.writeFile(p, "{ not json", "utf8");
    const store = new ArtifactStore(path.join(tmpDir, "session-artifacts"));
    const result = await migrateSessionsDehydrate({ sessionsPath: p, store });
    expect(result.skipReason).toBe("no-input");
  });

  it("preserves non-message fields verbatim", async () => {
    const sessionsPath = await writeV1File([
      { id: "a", title: "Keep me", model: { id: "m", family: "gemma" }, messages: [big] },
    ]);
    const store = new ArtifactStore(path.join(tmpDir, "session-artifacts"));
    await migrateSessionsDehydrate({ sessionsPath, store, skipBackup: true });
    const migrated = JSON.parse(await fs.readFile(sessionsPath, "utf8"));
    expect(migrated.sessions[0].title).toBe("Keep me");
    expect(migrated.sessions[0].model).toEqual({ id: "m", family: "gemma" });
  });
});
