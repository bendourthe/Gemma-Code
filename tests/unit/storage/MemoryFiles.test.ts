import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  MemoryFiles,
  deriveWorkspaceId,
  type MemoryExportPayload,
} from "../../../src/storage/MemoryFiles.js";

function makeTempBaseDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "gemma-mem-"));
}

describe("deriveWorkspaceId", () => {
  it("produces a stable id with basename + short hash", () => {
    const a = deriveWorkspaceId("/home/alice/projects/repo");
    const b = deriveWorkspaceId("/home/alice/projects/repo");
    expect(a).toBe(b);
    expect(a).toMatch(/^repo-[a-f0-9]{10}$/);
  });

  it("disambiguates same-basename workspaces by hashing the absolute path", () => {
    const a = deriveWorkspaceId("/home/alice/projects/repo");
    const b = deriveWorkspaceId("/home/bob/projects/repo");
    expect(a).not.toBe(b);
    expect(a.startsWith("repo-")).toBe(true);
    expect(b.startsWith("repo-")).toBe(true);
  });

  it("sanitises filesystem-unsafe characters in the basename", () => {
    const id = deriveWorkspaceId("/tmp/path with spaces & punctuation!");
    expect(id).toMatch(/^[A-Za-z0-9._-]+-[a-f0-9]{10}$/);
  });
});

describe("MemoryFiles", () => {
  let baseDir: string;
  let mf: MemoryFiles;

  beforeEach(() => {
    baseDir = makeTempBaseDir();
    mf = new MemoryFiles("test-workspace", baseDir);
  });

  describe("init()", () => {
    it("scaffolds the three files with required headings", () => {
      const result = mf.init();
      expect(result.instructions).toBe("created");
      expect(result.memory).toBe("created");
      expect(result.context).toBe("created");

      const instructions = fs.readFileSync(result.instructionsPath, "utf8");
      expect(instructions).toContain("## Who you are");
      expect(instructions).toContain("## What you do");
      expect(instructions).toContain("## Rules");
      expect(instructions).toContain("## What good outputs look like");
      expect(instructions).toContain("Update Memory.md with my preferences over time");

      const memory = fs.readFileSync(result.memoryPath, "utf8");
      expect(memory).toContain("## Preferences");
      expect(memory).toContain("## Corrections");
      expect(memory).toContain("## Patterns");
      expect(memory).toContain("## Decisions");

      const context = fs.readFileSync(result.contextPath, "utf8");
      expect(context).toContain("## About this project");
      expect(context).toContain("## Audience");
      expect(context).toContain("## Tools & stack");
      expect(context).toContain("## Important background");
    });

    it("skips existing files by default", () => {
      mf.init();
      fs.writeFileSync(mf.memoryPath, "user-edited content\n");
      const result = mf.init();
      expect(result.memory).toBe("skipped");
      expect(fs.readFileSync(mf.memoryPath, "utf8")).toBe("user-edited content\n");
    });

    it("force=true overwrites existing files", () => {
      mf.init();
      fs.writeFileSync(mf.memoryPath, "user-edited content\n");
      const result = mf.init(true);
      expect(result.memory).toBe("created");
      expect(fs.readFileSync(mf.memoryPath, "utf8")).toContain("## Preferences");
    });
  });

  describe("read()", () => {
    it("returns empty strings when no files exist", () => {
      const out = mf.read();
      expect(out.instructions).toBe("");
      expect(out.memory).toBe("");
      expect(out.context).toBe("");
    });

    it("caches results by mtime and re-reads when the file changes", () => {
      mf.init();
      const first = mf.read();
      expect(first.memory).toContain("## Preferences");

      // Mutate the file with an explicitly-newer mtime so the cache invalidates
      // even on filesystems with second-resolution timestamps.
      const future = new Date(Date.now() + 5_000);
      fs.writeFileSync(mf.memoryPath, "edited\n");
      fs.utimesSync(mf.memoryPath, future, future);

      const second = mf.read();
      expect(second.memory).toBe("edited\n");
    });
  });

  describe("archive()", () => {
    it("snapshots the three files into Archive/<YYYY-MM-DD>/", () => {
      mf.init();
      const result = mf.archive();
      expect(fs.existsSync(result.archivedPath)).toBe(true);
      expect(fs.existsSync(path.join(result.archivedPath, "Instructions.md"))).toBe(true);
      expect(fs.existsSync(path.join(result.archivedPath, "Memory.md"))).toBe(true);
      expect(fs.existsSync(path.join(result.archivedPath, "Context.md"))).toBe(true);
      const stamp = path.basename(result.archivedPath);
      expect(stamp).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it("latestArchiveDate returns the most recent snapshot", () => {
      expect(mf.latestArchiveDate()).toBeNull();
      mf.init();
      mf.archive();
      const latest = mf.latestArchiveDate();
      expect(latest).toBeInstanceOf(Date);
    });
  });

  describe("appendToMemory()", () => {
    it("appends a bullet under the requested section", () => {
      mf.init();
      mf.appendToMemory("Preferences", "I prefer short responses");
      const content = fs.readFileSync(mf.memoryPath, "utf8");
      expect(content).toMatch(/## Preferences\s*\n\s*\n- I prefer short responses/);
    });

    it("creates the section heading when absent", () => {
      fs.mkdirSync(mf.workspaceDir, { recursive: true });
      fs.writeFileSync(mf.memoryPath, "# Memory\n\n## Decisions\n");
      mf.appendToMemory("Patterns", "Always squash before tagging");
      const content = fs.readFileSync(mf.memoryPath, "utf8");
      expect(content).toContain("## Patterns");
      expect(content).toContain("- Always squash before tagging");
    });

    it("rejects lines that reference a secret path", () => {
      mf.init();
      expect(() =>
        mf.appendToMemory("Preferences", "credentials at /home/u/.aws/credentials"),
      ).toThrow(/secret-path/);
    });

    it("rejects unknown section names", () => {
      mf.init();
      expect(() =>
        // @ts-expect-error -- bad section by design
        mf.appendToMemory("Bogus", "nope"),
      ).toThrow(/Unknown memory section/);
    });
  });

  describe("removeFromMemory()", () => {
    it("removes lines matching the pattern", () => {
      mf.init();
      mf.appendToMemory("Preferences", "keep this");
      mf.appendToMemory("Preferences", "remove this");
      const result = mf.removeFromMemory(/remove this/);
      expect(result.removedLines).toBe(1);
      expect(fs.readFileSync(mf.memoryPath, "utf8")).not.toContain("remove this");
    });

    it("rejects catastrophic patterns", () => {
      mf.init();
      expect(() => mf.removeFromMemory(".*")).toThrow(/too greedy/);
      expect(() => mf.removeFromMemory(".+")).toThrow(/too greedy/);
      expect(() => mf.removeFromMemory(".")).toThrow(/too greedy/);
    });

    it("returns 0 when the file does not exist", () => {
      const result = mf.removeFromMemory(/anything/);
      expect(result.removedLines).toBe(0);
    });
  });

  describe("export() / import()", () => {
    it("round-trips files through a JSON export", () => {
      mf.init();
      mf.appendToMemory("Patterns", "Use Conventional Commits");

      const exportPath = path.join(baseDir, "export.json");
      mf.export(exportPath, {
        sqlMemories: [{ content: "user prefers dark theme", type: "fact" }],
      });

      const payload = JSON.parse(fs.readFileSync(exportPath, "utf8")) as MemoryExportPayload;
      expect(payload.version).toBe(1);
      expect(payload.workspaceId).toBe("test-workspace");
      expect(payload.files.memory).toContain("Use Conventional Commits");
      expect(payload.sqlMemories).toHaveLength(1);
      expect(payload.sqlMemories[0]?.source).toBe("sql");
    });

    it("import merge appends to existing content", () => {
      mf.init();
      mf.appendToMemory("Decisions", "Keep first decision");
      const exportPath = path.join(baseDir, "export.json");
      mf.export(exportPath);

      // Wipe and re-init in a different workspace, then merge from the export.
      const otherBase = makeTempBaseDir();
      const other = new MemoryFiles("other-workspace", otherBase);
      other.init();
      other.appendToMemory("Decisions", "Other decision");

      other.import(exportPath, "merge");
      const memory = fs.readFileSync(other.memoryPath, "utf8");
      expect(memory).toContain("Other decision");
      expect(memory).toContain("Keep first decision");
    });

    it("import replace overwrites existing content", () => {
      mf.init();
      mf.appendToMemory("Decisions", "Keep first decision");
      const exportPath = path.join(baseDir, "export.json");
      mf.export(exportPath);

      const otherBase = makeTempBaseDir();
      const other = new MemoryFiles("other-workspace", otherBase);
      other.init();
      other.appendToMemory("Decisions", "Other decision");

      other.import(exportPath, "replace");
      const memory = fs.readFileSync(other.memoryPath, "utf8");
      expect(memory).not.toContain("Other decision");
      expect(memory).toContain("Keep first decision");
    });

    it("export rejects secret-path destinations", () => {
      mf.init();
      expect(() => mf.export("/tmp/.env")).toThrow(/secret path/);
    });

    it("import rejects secret-path sources", () => {
      mf.init();
      expect(() => mf.import("/tmp/.env", "merge")).toThrow(/secret path/);
    });

    it("import surfaces a clear error on malformed JSON", () => {
      mf.init();
      const garbage = path.join(baseDir, "garbage.json");
      fs.writeFileSync(garbage, "not json");
      expect(() => mf.import(garbage, "merge")).toThrow(/Invalid memory export/);
    });
  });
});
