import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  buildMemorySnapshot,
  listArchiveSnapshots,
  listProposedSkills,
  promoteSqlMemoryToFile,
  restoreArchiveSnapshot,
  sectionForType,
} from "../../../src/panels/MemoryPanel.js";
import { MemoryFiles } from "../../../src/storage/MemoryFiles.js";

vi.mock("vscode", () => ({
  workspace: {
    openTextDocument: vi.fn(),
  },
  window: {
    showTextDocument: vi.fn(),
  },
  Uri: { file: (p: string) => ({ fsPath: p }) },
}));

/**
 * v0.7.0 Phase 5 -- MemoryPanel unit tests. The webview itself requires
 * VS Code APIs; the rendering and message-handling logic is exercised through
 * the panel's pure helper functions (buildMemorySnapshot, listArchiveSnapshots,
 * promoteSqlMemoryToFile, restoreArchiveSnapshot).
 */
describe("MemoryPanel data flow", () => {
  let tmpdir: string;
  let memoryFiles: MemoryFiles;

  beforeEach(() => {
    tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), "memory-panel-"));
    memoryFiles = new MemoryFiles("ws-1", tmpdir);
    memoryFiles.init();
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpdir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  });

  describe("buildMemorySnapshot", () => {
    it("returns workspaceMissing=true when no MemoryFiles is bound", () => {
      const snap = buildMemorySnapshot(null, null);
      expect(snap.workspaceMissing).toBe(true);
      expect(snap.instructions).toBe("");
      expect(snap.sqlMemories).toEqual([]);
      expect(snap.archive.snapshots).toEqual([]);
    });

    it("returns the three file contents and paths when MemoryFiles is bound", () => {
      const snap = buildMemorySnapshot(memoryFiles, null);
      expect(snap.workspaceMissing).toBe(false);
      expect(snap.instructions).toContain("# Instructions");
      expect(snap.memory).toContain("# Memory");
      expect(snap.context).toContain("# Context");
      expect(snap.instructionsPath).toBe(memoryFiles.instructionsPath);
      expect(snap.sqlMemories).toEqual([]);
    });

    it("includes SQL-backed memories when a MemoryStore is bound", () => {
      const fakeStore = {
        listAll: vi.fn(() => [
          {
            id: "m1",
            sessionId: null,
            content: "prefer Conventional Commits",
            type: "preference",
            embedding: null,
            createdAt: 1000,
            accessedAt: 2000,
            accessCount: 3,
            relevanceDecay: 1,
            corroborationCount: 1,
          },
        ]),
      };
      const snap = buildMemorySnapshot(memoryFiles, fakeStore as never);
      expect(fakeStore.listAll).toHaveBeenCalledWith(500);
      expect(snap.sqlMemories).toHaveLength(1);
      expect(snap.sqlMemories[0]).toEqual({
        id: "m1",
        content: "prefer Conventional Commits",
        type: "preference",
        createdAt: 1000,
        accessCount: 3,
      });
    });

    it("lists archive snapshots newest-first", () => {
      memoryFiles.archive();
      // Inject two more dated snapshots manually.
      fs.mkdirSync(path.join(memoryFiles.archiveDir, "2025-01-01"), { recursive: true });
      fs.mkdirSync(path.join(memoryFiles.archiveDir, "2024-06-15"), { recursive: true });
      // Plus a non-dated entry that must be ignored.
      fs.mkdirSync(path.join(memoryFiles.archiveDir, "scratch"), { recursive: true });

      const snap = buildMemorySnapshot(memoryFiles, null);
      const dates = snap.archive.snapshots.map((s) => s.date);
      expect(dates[dates.length - 1]).toBe("2024-06-15");
      expect(dates).not.toContain("scratch");
      expect(dates[0]).toBeDefined();
    });
  });

  describe("listArchiveSnapshots", () => {
    it("returns an empty array when the directory does not exist", () => {
      expect(listArchiveSnapshots(path.join(tmpdir, "missing"))).toEqual([]);
    });

    it("ignores non-dated directories", () => {
      const dir = path.join(tmpdir, "Archive");
      fs.mkdirSync(path.join(dir, "2026-01-01"), { recursive: true });
      fs.mkdirSync(path.join(dir, "notes"), { recursive: true });
      const snaps = listArchiveSnapshots(dir);
      expect(snaps).toEqual([{ date: "2026-01-01" }]);
    });
  });

  describe("promoteSqlMemoryToFile", () => {
    it("appends a SQL row's content into the matching Memory.md section and deletes the row", () => {
      const row = {
        id: "m1",
        sessionId: null,
        content: "Always squash-merge before tagging",
        type: "decision",
        embedding: null,
        createdAt: 0,
        accessedAt: 0,
        accessCount: 0,
        relevanceDecay: 1,
        corroborationCount: 1,
      };
      const fakeStore = {
        listAll: vi.fn(() => [row]),
        deleteById: vi.fn(() => true),
      };
      const result = promoteSqlMemoryToFile(memoryFiles, fakeStore as never, "m1");
      expect(result).toEqual({ ok: true, section: "Decisions" });
      expect(fakeStore.deleteById).toHaveBeenCalledWith("m1");
      const memory = fs.readFileSync(memoryFiles.memoryPath, "utf8");
      expect(memory).toContain("Always squash-merge before tagging");
      expect(memory).toContain("## Decisions");
    });

    it("returns ok=false when the id is not found", () => {
      const fakeStore = { listAll: vi.fn(() => []), deleteById: vi.fn() };
      const result = promoteSqlMemoryToFile(memoryFiles, fakeStore as never, "nope");
      expect(result).toEqual({ ok: false, reason: "Memory not found" });
      expect(fakeStore.deleteById).not.toHaveBeenCalled();
    });

    it("returns ok=false when the underlying append rejects (secret-path)", () => {
      const row = {
        id: "m1",
        sessionId: null,
        content: "credentials at /home/me/.aws/credentials",
        type: "fact",
        embedding: null,
        createdAt: 0,
        accessedAt: 0,
        accessCount: 0,
        relevanceDecay: 1,
        corroborationCount: 1,
      };
      const fakeStore = {
        listAll: vi.fn(() => [row]),
        deleteById: vi.fn(() => true),
      };
      const result = promoteSqlMemoryToFile(memoryFiles, fakeStore as never, "m1");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toMatch(/secret-path/);
      }
      expect(fakeStore.deleteById).not.toHaveBeenCalled();
    });
  });

  describe("sectionForType", () => {
    it("maps SQL types to Memory.md section headings", () => {
      expect(sectionForType("decision")).toBe("Decisions");
      expect(sectionForType("preference")).toBe("Preferences");
      expect(sectionForType("error_resolution")).toBe("Corrections");
      expect(sectionForType("file_pattern")).toBe("Patterns");
      expect(sectionForType("fact")).toBe("Preferences");
      expect(sectionForType("anything-else")).toBe("Preferences");
    });
  });

  describe("restoreArchiveSnapshot", () => {
    it("restores the three files from a dated snapshot", () => {
      // Seed Memory.md with a known marker, archive, mutate, then restore.
      memoryFiles.appendToMemory("Preferences", "Snapshotted preference");
      const archived = memoryFiles.archive();
      const date = path.basename(archived.archivedPath);

      // Mutate the live Memory.md so the restore is observable.
      fs.writeFileSync(memoryFiles.memoryPath, "# Memory\n\n(replaced)\n", "utf8");
      expect(fs.readFileSync(memoryFiles.memoryPath, "utf8")).toContain("(replaced)");

      const result = restoreArchiveSnapshot(memoryFiles, date);
      expect(result.ok).toBe(true);
      const restored = fs.readFileSync(memoryFiles.memoryPath, "utf8");
      expect(restored).toContain("Snapshotted preference");
    });

    it("rejects malformed dates", () => {
      const result = restoreArchiveSnapshot(memoryFiles, "not-a-date");
      expect(result).toEqual({ ok: false, reason: "Invalid archive date" });
    });

    it("rejects missing snapshots", () => {
      const result = restoreArchiveSnapshot(memoryFiles, "2099-01-01");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toContain("does not exist");
    });
  });

  // v0.9.0 Phase 2.6 ------------------------------------------------------

  describe("listProposedSkills (Phase 2.6)", () => {
    it("returns an empty array when the proposed dir does not exist", () => {
      expect(listProposedSkills(path.join(tmpdir, "nope"))).toEqual([]);
    });

    it("enumerates proposed/<slug>/SKILL.md entries newest-first", () => {
      const skillsRoot = path.join(tmpdir, "catalog");
      const olderDir = path.join(skillsRoot, "proposed", "alpha");
      const newerDir = path.join(skillsRoot, "proposed", "beta");
      fs.mkdirSync(olderDir, { recursive: true });
      fs.mkdirSync(newerDir, { recursive: true });
      fs.writeFileSync(path.join(olderDir, "SKILL.md"), "alpha body");
      fs.writeFileSync(path.join(newerDir, "SKILL.md"), "beta body");
      // Force a clear mtime gap so the ordering is deterministic.
      const older = Date.now() - 60_000;
      const newer = Date.now();
      fs.utimesSync(path.join(olderDir, "SKILL.md"), older / 1000, older / 1000);
      fs.utimesSync(path.join(newerDir, "SKILL.md"), newer / 1000, newer / 1000);

      const out = listProposedSkills(skillsRoot);
      expect(out.map((e) => e.slug)).toEqual(["beta", "alpha"]);
      expect(out[0].preview).toContain("beta body");
    });

    it("buildMemorySnapshot includes proposedSkills when a skillsRoot is supplied", () => {
      const skillsRoot = path.join(tmpdir, "catalog");
      const dir = path.join(skillsRoot, "proposed", "demo");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "SKILL.md"), "draft");
      const snap = buildMemorySnapshot(memoryFiles, null, {
        proposedSkillsRoot: skillsRoot,
      });
      expect(snap.proposedSkills).toHaveLength(1);
      expect(snap.proposedSkills[0]?.slug).toBe("demo");
    });
  });
});
