import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  discoverGemmaContextFiles,
  readGemmaContextFiles,
} from "../../../src/storage/MemoryFiles.js";

describe("discoverGemmaContextFiles", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "gemma-ctx-walk-"));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function makeNestedRepo(): { gitRoot: string; deepest: string; midPath: string; topPath: string; deepPath: string } {
    const gitRoot = path.join(root, "repo");
    const mid = path.join(gitRoot, "src");
    const deepest = path.join(mid, "feature");
    fs.mkdirSync(deepest, { recursive: true });
    fs.mkdirSync(path.join(gitRoot, ".git"), { recursive: true });
    const topPath = path.join(gitRoot, ".gemma.md");
    const midPath = path.join(mid, ".gemma.md");
    const deepPath = path.join(deepest, ".gemma.md");
    fs.writeFileSync(topPath, "TOP-LEVEL CONTEXT");
    fs.writeFileSync(midPath, "MID-LEVEL CONTEXT");
    fs.writeFileSync(deepPath, "DEEP-LEVEL CONTEXT");
    return { gitRoot, deepest, midPath, topPath, deepPath };
  }

  it("finds all .gemma.md files from cwd up to the git root", () => {
    const { deepest, midPath, topPath, deepPath } = makeNestedRepo();
    const files = discoverGemmaContextFiles(deepest);
    expect(files).toEqual([deepPath, midPath, topPath]);
  });

  it("stops at the filesystem root when no .git directory is found", () => {
    const orphan = path.join(root, "no-git");
    fs.mkdirSync(orphan, { recursive: true });
    fs.writeFileSync(path.join(orphan, ".gemma.md"), "orphan");
    const files = discoverGemmaContextFiles(orphan);
    expect(files).toHaveLength(1);
    expect(files[0]).toContain(".gemma.md");
  });

  it("readGemmaContextFiles concatenates each file under a header", () => {
    const { deepest } = makeNestedRepo();
    const merged = readGemmaContextFiles(deepest);
    expect(merged).toContain("DEEP-LEVEL CONTEXT");
    expect(merged).toContain("MID-LEVEL CONTEXT");
    expect(merged).toContain("TOP-LEVEL CONTEXT");
    expect(merged.indexOf("DEEP-LEVEL")).toBeLessThan(merged.indexOf("MID-LEVEL"));
  });

  it("returns an empty list when no .gemma.md exists anywhere on the walk", () => {
    const empty = path.join(root, "blank");
    fs.mkdirSync(empty, { recursive: true });
    fs.mkdirSync(path.join(empty, ".git"), { recursive: true });
    const files = discoverGemmaContextFiles(empty);
    expect(files).toHaveLength(0);
    expect(readGemmaContextFiles(empty)).toBe("");
  });
});
