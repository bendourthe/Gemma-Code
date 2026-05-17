import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PlanArchive } from "../../../src/storage/PlanArchive.js";

function tmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "plan-archive-test-"));
}

describe("PlanArchive", () => {
  let root: string;

  beforeEach(() => {
    root = tmpRoot();
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("appendVersion() returns monotonically increasing version numbers and writes one file per call", () => {
    const archive = new PlanArchive({ rootDir: root, workspaceId: "ws1" });
    const v1 = archive.appendVersion("auth", "1. Read file\n2. Parse\n");
    const v2 = archive.appendVersion("auth", "1. Read file\n2. Parse\n3. Validate\n");
    expect(v1).toBe(1);
    expect(v2).toBe(2);
    const dir = path.join(root, "ws1", "auth");
    const files = fs.readdirSync(dir).sort();
    expect(files).toEqual(["0001.md", "0002.md"]);
  });

  it("listVersions() returns all persisted versions sorted by version number", () => {
    const archive = new PlanArchive({ rootDir: root, workspaceId: "ws1" });
    archive.appendVersion("auth", "first");
    archive.appendVersion("auth", "second");
    archive.appendVersion("auth", "third");
    const versions = archive.listVersions("auth");
    expect(versions.map((v) => v.version)).toEqual([1, 2, 3]);
    expect(versions.map((v) => v.content)).toEqual(["first", "second", "third"]);
  });

  it("listVersions() returns an empty array when the slug directory does not exist", () => {
    const archive = new PlanArchive({ rootDir: root, workspaceId: "ws1" });
    expect(archive.listVersions("ghost")).toEqual([]);
  });

  it("listVersions() tolerates non-version filenames in the slug directory", () => {
    const archive = new PlanArchive({ rootDir: root, workspaceId: "ws1" });
    archive.appendVersion("auth", "first");
    fs.writeFileSync(path.join(archive.slugDir("auth"), "notes.txt"), "stray");
    fs.writeFileSync(path.join(archive.slugDir("auth"), "0001.bak"), "stray");
    const versions = archive.listVersions("auth");
    expect(versions).toHaveLength(1);
    expect(versions[0]?.version).toBe(1);
  });

  it("getVersion() returns content for an existing version and null when missing", () => {
    const archive = new PlanArchive({ rootDir: root, workspaceId: "ws1" });
    archive.appendVersion("auth", "v1 content");
    expect(archive.getVersion("auth", 1)).toBe("v1 content");
    expect(archive.getVersion("auth", 99)).toBeNull();
  });

  it("appendVersion() bumps the next version even when a manual gap exists", () => {
    const archive = new PlanArchive({ rootDir: root, workspaceId: "ws1" });
    archive.appendVersion("auth", "first");
    archive.appendVersion("auth", "second");
    fs.unlinkSync(path.join(archive.slugDir("auth"), "0001.md"));
    const v = archive.appendVersion("auth", "third");
    expect(v).toBe(2);
  });

  it("rejects unsafe slug components to prevent directory traversal", () => {
    const archive = new PlanArchive({ rootDir: root, workspaceId: "ws1" });
    expect(() => archive.appendVersion("../escape", "x")).toThrow(/invalid plan slug/);
    expect(() => archive.appendVersion("with space", "x")).toThrow(/invalid plan slug/);
  });

  it("diff() produces classic, clean, and raw modes between two persisted versions", () => {
    const archive = new PlanArchive({ rootDir: root, workspaceId: "ws1" });
    archive.appendVersion("auth", "1. Read file\n2. Apply edits\n");
    archive.appendVersion("auth", "1. Read file\n2. Apply edits\n3. Run tests\n");
    const result = archive.diff("auth", 1, 2);
    expect(result.classic).toContain("+3. Run tests");
    expect(result.classic).toContain(" 1. Read file");
    expect(result.clean).toContain("3. Run tests");
    expect(result.raw).toContain("--- auth.md");
    expect(result.raw).toContain("+3. Run tests");
  });

  it("diff() throws when either version is missing", () => {
    const archive = new PlanArchive({ rootDir: root, workspaceId: "ws1" });
    archive.appendVersion("auth", "first");
    expect(() => archive.diff("auth", 1, 5)).toThrow(/missing version 5/);
    expect(() => archive.diff("auth", 5, 1)).toThrow(/missing version 5/);
  });

  it("static computeDiff() renders addition markers in clean mode and prefix markers in classic mode", () => {
    const out = PlanArchive.computeDiff(
      "1. Read\n2. Apply\n",
      "1. Read\n2. Apply\n3. Verify\n",
      "auth",
      1,
      2,
    );
    // Clean: addition is wrapped in `**`. Phase 6.4 -- closing `**` must
    // not orphan onto the next line; trailing newlines now appear AFTER
    // the closing marker.
    expect(out.clean).toContain("**3. Verify");
    expect(out.clean).toMatch(/\*\*[^*]*\*\*/);
    // Classic: added lines start with `+`, context with ` `.
    const lines = out.classic.split("\n");
    expect(lines.some((l) => l.startsWith("+3. Verify"))).toBe(true);
    expect(lines.some((l) => l.startsWith(" 1. Read"))).toBe(true);
  });

  it("clean diff strips trailing newlines from add/del runs (Phase 6.4)", () => {
    const out = PlanArchive.computeDiff(
      "1. Read\n2. Apply\n",
      "1. Read\n2. Apply\n3. Verify\n",
      "auth",
      1,
      2,
    );
    // Negative assertion: the closing `**` must NOT sit on a line that
    // begins with a newline. Match any `**...\n**` segment -- previous
    // behaviour produced `**3. Verify\n**` which orphans the closing
    // marker; fixed behaviour produces `**3. Verify**\n`.
    expect(out.clean).not.toMatch(/\*\*[^*]*?\n\*\*/);
  });

  it("wrapDiffRun preserves trailing newlines outside the markers", async () => {
    const { wrapDiffRun } = await import("../../../src/storage/PlanArchive.js");
    expect(wrapDiffRun("hello\n", "**")).toBe("**hello**\n");
    expect(wrapDiffRun("hello\n\n", "**")).toBe("**hello**\n\n");
    expect(wrapDiffRun("hello", "**")).toBe("**hello**");
    expect(wrapDiffRun("", "**")).toBe("");
    // Pure-newline run is left alone -- no inner content to wrap.
    expect(wrapDiffRun("\n", "**")).toBe("\n");
    // Strikethrough marker wraps cleanly too.
    expect(wrapDiffRun("removed line\n", "~~")).toBe("~~removed line~~\n");
  });

  it("normalizes workspace ids derived from filesystem paths into a single segment", () => {
    const archive = new PlanArchive({
      rootDir: root,
      workspaceId: "C:/Users/test/Project",
    });
    archive.appendVersion("auth", "first");
    // The exact normalization is an implementation detail; we only check
    // that the result is a single path segment under the root.
    const wsDirs = fs.readdirSync(root);
    expect(wsDirs).toHaveLength(1);
    expect(wsDirs[0]).not.toContain("/");
    expect(wsDirs[0]).not.toContain("\\");
  });
});
