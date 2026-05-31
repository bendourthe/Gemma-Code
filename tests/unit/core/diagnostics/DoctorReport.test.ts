import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  buildDoctorReport,
  formatDoctorReport,
  formatBytes,
  KNOWN_CACHE_DIRS,
  MIGRATION_MARKER_FILE,
  type DoctorInputs,
  type DoctorFsApi,
} from "../../../../core/diagnostics/DoctorReport.js";

/**
 * A fake read-only fs that reports two symlinks under `homeDir` -- one live,
 * one dangling -- and nothing else. Lets the symlink branch run portably
 * (creating real symlinks needs admin on Windows).
 */
function fakeFsWithSymlinks(homeDir: string): DoctorFsApi {
  const dead = path.join(homeDir, "dead-link");
  const dirent = (name: string) => ({
    name,
    isSymbolicLink: () => true,
    isDirectory: () => false,
    isFile: () => false,
  });
  return {
    existsSync: (() => false),
    readdirSync: ((p: string) =>
      p === homeDir ? [dirent("live-link"), dirent("dead-link")] : []),
    statSync: ((p: string) => {
      if (p === dead) throw new Error("ENOENT");
      return { size: 10, mtimeMs: 0 };
    }),
    lstatSync: (() => ({ isSymbolicLink: () => true })),
    readFileSync: (() => ""),
  } as unknown as DoctorFsApi;
}

/**
 * v1.4.0 Phase 5 (A6) -- unit coverage for the pure doctor inventory.
 *
 * Uses real temp directories so the read APIs exercise genuine fs entries;
 * the builder never writes, so the fixtures are safe.
 */

function writeSkill(root: string, dirName: string, skillName: string): void {
  const dir = path.join(root, dirName);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "SKILL.md"),
    `---\nname: ${skillName}\ndescription: desc for ${skillName}\n---\n\n# ${skillName}\n`,
    "utf8",
  );
}

describe("buildDoctorReport", () => {
  let nexusHome: string;
  let legacyHome: string;

  beforeEach(() => {
    nexusHome = fs.mkdtempSync(path.join(os.tmpdir(), "doctor-unit-home-"));
    legacyHome = fs.mkdtempSync(path.join(os.tmpdir(), "doctor-unit-legacy-"));
  });

  afterEach(() => {
    fs.rmSync(nexusHome, { recursive: true, force: true });
    fs.rmSync(legacyHome, { recursive: true, force: true });
    // legacyHome may have been removed by a symlink test; force ignores ENOENT.
  });

  it("reports an empty inventory for a pristine home with no legacy state", () => {
    fs.rmSync(legacyHome, { recursive: true, force: true });
    const report = buildDoctorReport({
      nexusHome,
      legacyGemmaHome: legacyHome,
      now: () => new Date("2026-05-30T00:00:00.000Z"),
    });
    expect(report.findings).toEqual([]);
    expect(report.summary).toEqual({ info: 0, warn: 0, total: 0 });
    expect(formatDoctorReport(report)).toContain("No stale state detected");
  });

  it("flags a real legacy ~/.gemma-code/ directory as a warning", () => {
    fs.writeFileSync(path.join(legacyHome, "old.db"), "abc", "utf8");
    const report = buildDoctorReport({ nexusHome, legacyGemmaHome: legacyHome });
    const legacy = report.findings.find((f) => f.category === "legacy-state");
    expect(legacy?.severity).toBe("warn");
    expect(legacy?.sizeBytes).toBe(3);
  });

  it("reports the migration marker as info", () => {
    fs.writeFileSync(path.join(nexusHome, MIGRATION_MARKER_FILE), "x", "utf8");
    fs.rmSync(legacyHome, { recursive: true, force: true });
    const report = buildDoctorReport({ nexusHome, legacyGemmaHome: legacyHome });
    expect(report.findings.some((f) => f.category === "migration-marker")).toBe(true);
    expect(report.findings.every((f) => f.severity === "info")).toBe(true);
  });

  it("flags an old cache dir as stale and a fresh one as info", () => {
    fs.rmSync(legacyHome, { recursive: true, force: true });
    const cacheName = KNOWN_CACHE_DIRS[0];
    const cacheDir = path.join(nexusHome, cacheName);
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(path.join(cacheDir, "a.bin"), "y".repeat(2048), "utf8");
    // Backdate the cache dir mtime well beyond the staleness threshold.
    const old = new Date("2026-01-01T00:00:00.000Z");
    fs.utimesSync(cacheDir, old, old);

    const stale = buildDoctorReport({
      nexusHome,
      legacyGemmaHome: legacyHome,
      now: () => new Date("2026-05-30T00:00:00.000Z"),
      staleCacheDays: 30,
    });
    const f = stale.findings.find((x) => x.category === "stale-cache");
    expect(f?.severity).toBe("warn");
    expect(f?.title).toContain("Stale cache dir");

    const fresh = buildDoctorReport({
      nexusHome,
      legacyGemmaHome: legacyHome,
      now: () => new Date("2026-05-30T00:00:00.000Z"),
      staleCacheDays: 9999,
    });
    expect(fresh.findings.find((x) => x.category === "stale-cache")?.severity).toBe("info");
  });

  it("detects a skill name duplicated across two roots", () => {
    fs.rmSync(legacyHome, { recursive: true, force: true });
    const rootA = fs.mkdtempSync(path.join(os.tmpdir(), "doctor-skills-a-"));
    const rootB = fs.mkdtempSync(path.join(os.tmpdir(), "doctor-skills-b-"));
    try {
      writeSkill(rootA, "alpha", "shared-skill");
      writeSkill(rootB, "alpha-copy", "shared-skill");
      writeSkill(rootB, "unique", "only-in-b");
      const report = buildDoctorReport({
        nexusHome,
        legacyGemmaHome: legacyHome,
        skillRoots: [
          { dir: rootA, source: "builtin" },
          { dir: rootB, source: "user" },
        ],
      });
      const dupes = report.findings.filter((f) => f.category === "duplicate-skill");
      expect(dupes).toHaveLength(1);
      expect(dupes[0]?.title).toContain("shared-skill");
      expect(dupes[0]?.severity).toBe("warn");
    } finally {
      fs.rmSync(rootA, { recursive: true, force: true });
      fs.rmSync(rootB, { recursive: true, force: true });
    }
  });

  it("reports memory state when ~/.nexus/memory exists", () => {
    fs.rmSync(legacyHome, { recursive: true, force: true });
    const memDir = path.join(nexusHome, "memory");
    fs.mkdirSync(memDir, { recursive: true });
    fs.writeFileSync(path.join(memDir, "rows.jsonl"), '{"id":1}\n', "utf8");
    const report = buildDoctorReport({ nexusHome, legacyGemmaHome: legacyHome });
    const mem = report.findings.find((f) => f.category === "memory-state");
    expect(mem?.severity).toBe("info");
    expect(mem?.sizeBytes).toBeGreaterThan(0);
  });

  it("migrationReport flag widens the rendered detail (paths + suggestions)", () => {
    fs.writeFileSync(path.join(legacyHome, "old.db"), "abc", "utf8");
    const report = buildDoctorReport({
      nexusHome,
      legacyGemmaHome: legacyHome,
      migrationReport: true,
    });
    const text = formatDoctorReport(report);
    expect(text).toContain("path:");
    expect(text).toContain("suggestion:");
    expect(text).not.toContain("Re-run with --migration-report");
  });

  it("inventories live and dangling symlinks via an injected fs", () => {
    const report = buildDoctorReport({
      nexusHome,
      legacyGemmaHome: legacyHome,
      fsApi: fakeFsWithSymlinks(nexusHome),
    });
    const links = report.findings.filter((f) => f.category === "symlink");
    expect(links).toHaveLength(2);
    const dead = links.find((f) => f.title.startsWith("Dangling"));
    const live = links.find((f) => f.title.startsWith("Symlink"));
    expect(dead?.severity).toBe("warn");
    expect(live?.severity).toBe("info");
  });

  it("renders the --migration-report hint for a non-empty summary report", () => {
    fs.writeFileSync(path.join(legacyHome, "old.db"), "abc", "utf8");
    const report = buildDoctorReport({ nexusHome, legacyGemmaHome: legacyHome });
    expect(report.migrationReport).toBe(false);
    const text = formatDoctorReport(report);
    expect(text).toContain("Summary:");
    expect(text).toContain("Re-run with --migration-report");
  });

  it("formatBytes renders B / KB / MB thresholds", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(3 * 1024 * 1024)).toBe("3.0 MB");
  });

  it("is read-only: re-running yields an identical inventory and never writes", () => {
    fs.writeFileSync(path.join(legacyHome, "old.db"), "abc", "utf8");
    const inputs: DoctorInputs = {
      nexusHome,
      legacyGemmaHome: legacyHome,
      now: () => new Date("2026-05-30T00:00:00.000Z"),
    };
    const before = fs.readdirSync(nexusHome).sort();
    const r1 = buildDoctorReport(inputs);
    const r2 = buildDoctorReport(inputs);
    expect(r1.findings).toEqual(r2.findings);
    // No directory entries were created by the inventory.
    expect(fs.readdirSync(nexusHome).sort()).toEqual(before);
  });
});
