/**
 * v1.0.0 Phase 2.2 -- StorageMigration tests.
 *
 * Uses a per-test temp HOME so the real `~/.gemma-code/` and `~/.nexus/`
 * directories are never touched. Covers:
 *  - fresh-install branch
 *  - already-migrated branch
 *  - happy-path migration (file count, mtime preservation, marker)
 *  - skip rules (.DS_Store, *.lock)
 *  - second run is a no-op (idempotency)
 *  - POSIX symlink path (when not on Windows)
 *  - Windows README path (forced via deps.platform)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  runStorageMigration,
  type MigrationResult,
} from "../../../../core/storage/StorageMigration.js";

let tempHome: string;
let homeDirFn: () => string;

beforeEach(() => {
  tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-migration-"));
  homeDirFn = () => tempHome;
});

afterEach(() => {
  // Best-effort cleanup; the system tempdir reaper will catch any leftover.
  try {
    fs.rmSync(tempHome, { recursive: true, force: true });
  } catch {
    // Non-fatal.
  }
});

function legacyPath(...segments: string[]): string {
  return path.join(tempHome, ".gemma-code", ...segments);
}

function nexusPath(...segments: string[]): string {
  return path.join(tempHome, ".nexus", ...segments);
}

describe("runStorageMigration", () => {
  it("creates ~/.nexus/ for a fresh install", () => {
    const result = runStorageMigration({ homeDirFn });
    expect(result.status).toBe("fresh-install");
    expect(fs.existsSync(nexusPath())).toBe(true);
    expect(result.filesCopied).toBe(0);
    expect(fs.existsSync(legacyPath())).toBe(false);
  });

  it("is a no-op when ~/.nexus/ already exists (already-migrated)", () => {
    fs.mkdirSync(nexusPath(), { recursive: true });
    fs.writeFileSync(nexusPath("marker.txt"), "do-not-delete", "utf8");

    const result = runStorageMigration({ homeDirFn });
    expect(result.status).toBe("already-migrated");
    expect(result.filesCopied).toBe(0);
    expect(fs.readFileSync(nexusPath("marker.txt"), "utf8")).toBe(
      "do-not-delete",
    );
  });

  it("copies three files from legacy ~/.gemma-code/ to ~/.nexus/", () => {
    fs.mkdirSync(legacyPath("memory"), { recursive: true });
    fs.writeFileSync(legacyPath("memory", "one.md"), "1");
    fs.writeFileSync(legacyPath("memory", "two.md"), "2");
    fs.writeFileSync(legacyPath("three.md"), "3");

    const result = runStorageMigration({ homeDirFn, platform: "win32" });

    expect(result.status).toBe("migrated");
    expect(result.filesCopied).toBe(3);
    expect(fs.readFileSync(nexusPath("memory", "one.md"), "utf8")).toBe("1");
    expect(fs.readFileSync(nexusPath("memory", "two.md"), "utf8")).toBe("2");
    expect(fs.readFileSync(nexusPath("three.md"), "utf8")).toBe("3");
    expect(fs.existsSync(nexusPath("migrated-from-gemma-code.txt"))).toBe(true);
  });

  it("skips .DS_Store and *.lock files during migration", () => {
    fs.mkdirSync(legacyPath(), { recursive: true });
    fs.writeFileSync(legacyPath("real.md"), "real");
    fs.writeFileSync(legacyPath(".DS_Store"), "binary-cruft");
    fs.writeFileSync(legacyPath("db.lock"), "stale-lock");

    const result = runStorageMigration({ homeDirFn, platform: "win32" });

    expect(result.filesCopied).toBe(1);
    expect(fs.existsSync(nexusPath("real.md"))).toBe(true);
    expect(fs.existsSync(nexusPath(".DS_Store"))).toBe(false);
    expect(fs.existsSync(nexusPath("db.lock"))).toBe(false);
  });

  it("is idempotent: a second run reports already-migrated", () => {
    fs.mkdirSync(legacyPath(), { recursive: true });
    fs.writeFileSync(legacyPath("a.md"), "a");

    const first = runStorageMigration({ homeDirFn, platform: "win32" });
    expect(first.status).toBe("migrated");

    const second = runStorageMigration({ homeDirFn, platform: "win32" });
    expect(second.status).toBe("already-migrated");
    expect(second.filesCopied).toBe(0);
    expect(fs.readFileSync(nexusPath("a.md"), "utf8")).toBe("a");
  });

  it("on Windows leaves the legacy dir with a MOVED-TO-NEXUS.txt README", () => {
    fs.mkdirSync(legacyPath(), { recursive: true });
    fs.writeFileSync(legacyPath("config.json"), "{}");

    const result = runStorageMigration({ homeDirFn, platform: "win32" });
    expect(result.legacyPreserved).toBe(true);
    expect(result.legacySymlinked).toBe(false);
    expect(fs.existsSync(legacyPath("MOVED-TO-NEXUS.txt"))).toBe(true);
    expect(fs.existsSync(legacyPath("config.json"))).toBe(true);
  });

  it("preserves file mtimes when copying", () => {
    fs.mkdirSync(legacyPath(), { recursive: true });
    const src = legacyPath("history.md");
    fs.writeFileSync(src, "x");
    const old = new Date(Date.now() - 24 * 60 * 60 * 1000);
    fs.utimesSync(src, old, old);

    runStorageMigration({ homeDirFn, platform: "win32" });

    const newStat = fs.statSync(nexusPath("history.md"));
    expect(Math.abs(newStat.mtime.getTime() - old.getTime())).toBeLessThan(2000);
  });

  it("writes a marker file with file count and timestamp", () => {
    fs.mkdirSync(legacyPath(), { recursive: true });
    fs.writeFileSync(legacyPath("a.md"), "");
    fs.writeFileSync(legacyPath("b.md"), "");

    runStorageMigration({ homeDirFn, platform: "win32" });

    const marker = fs.readFileSync(
      nexusPath("migrated-from-gemma-code.txt"),
      "utf8",
    );
    expect(marker).toContain("Migrated at:");
    expect(marker).toContain("Files copied: 2");
  });

  it("on POSIX, creates a symlink from the legacy dir to ~/.nexus/ after copy", function () {
    // Symlink creation can fail in some sandbox environments; skip if we
    // cannot create one in tmpdir.
    const probeSrc = path.join(tempHome, ".probe-src");
    const probeLink = path.join(tempHome, ".probe-link");
    fs.mkdirSync(probeSrc);
    try {
      fs.symlinkSync(probeSrc, probeLink, "dir");
    } catch {
      // Skip on platforms / containers where symlink creation is denied.
      return;
    }
    fs.rmSync(probeLink, { force: true });
    fs.rmSync(probeSrc, { recursive: true, force: true });

    fs.mkdirSync(legacyPath(), { recursive: true });
    fs.writeFileSync(legacyPath("data.json"), "{}");

    const result: MigrationResult = runStorageMigration({
      homeDirFn,
      platform: "linux",
    });
    expect(result.status).toBe("migrated");
    expect(result.legacySymlinked).toBe(true);
    expect(result.legacyPreserved).toBe(false);
    const linkStat = fs.lstatSync(legacyPath());
    expect(linkStat.isSymbolicLink()).toBe(true);
    // Following the symlink should land on the new file.
    expect(fs.readFileSync(legacyPath("data.json"), "utf8")).toBe("{}");
  });

  it("recurses into nested directories", () => {
    fs.mkdirSync(legacyPath("a", "b", "c"), { recursive: true });
    fs.writeFileSync(legacyPath("a", "top.md"), "T");
    fs.writeFileSync(legacyPath("a", "b", "mid.md"), "M");
    fs.writeFileSync(legacyPath("a", "b", "c", "deep.md"), "D");

    const result = runStorageMigration({ homeDirFn, platform: "win32" });
    expect(result.filesCopied).toBe(3);
    expect(fs.readFileSync(nexusPath("a", "top.md"), "utf8")).toBe("T");
    expect(fs.readFileSync(nexusPath("a", "b", "mid.md"), "utf8")).toBe("M");
    expect(fs.readFileSync(nexusPath("a", "b", "c", "deep.md"), "utf8")).toBe(
      "D",
    );
  });
});
