import { describe, it, expect } from "vitest";
import {
  parseIgnoreFile,
  mergeIgnorePatterns,
  defaultIgnorePatterns,
  matchesIgnore,
  NEXUS_IGNORE_DEFAULTS,
} from "../../../../core/storage/NexusIgnore.js";

describe("parseIgnoreFile", () => {
  it("returns empty patterns for null / empty input", () => {
    const empty = parseIgnoreFile(null);
    expect(empty.directoryNames.size).toBe(0);
    expect(empty.literalPaths.size).toBe(0);
    expect(empty.suffixPatterns).toEqual([]);
  });

  it("skips blank lines and comments", () => {
    const out = parseIgnoreFile("# header\n\nnode_modules/\n\n# tail\n");
    expect(out.directoryNames.has("node_modules")).toBe(true);
  });

  it("parses directory entries", () => {
    const out = parseIgnoreFile("node_modules/\ndist/\nbuild/");
    expect(out.directoryNames.has("node_modules")).toBe(true);
    expect(out.directoryNames.has("dist")).toBe(true);
    // "build" has no trailing slash, but no slash or wildcard either ->
    // also treated as a directory name.
    expect(out.directoryNames.has("build")).toBe(true);
  });

  it("parses suffix patterns", () => {
    const out = parseIgnoreFile("*.tsbuildinfo\n*.coverage\n");
    expect(out.suffixPatterns).toContain(".tsbuildinfo");
    expect(out.suffixPatterns).toContain(".coverage");
  });

  it("parses literal paths", () => {
    const out = parseIgnoreFile("/docs/archive/legacy\nsrc/foo/bar");
    expect(out.literalPaths.has("docs/archive/legacy")).toBe(true);
    expect(out.literalPaths.has("src/foo/bar")).toBe(true);
  });

  it("skips negation lines (no negation support in regex scanner)", () => {
    const out = parseIgnoreFile("!important.md\nnode_modules/\n");
    expect(out.literalPaths.has("important.md")).toBe(false);
    expect(out.directoryNames.has("node_modules")).toBe(true);
  });
});

describe("matchesIgnore", () => {
  it("matches a directory-name segment anywhere in the path", () => {
    const p = parseIgnoreFile("node_modules/");
    expect(matchesIgnore("node_modules/foo.js", p)).toBe(true);
    expect(matchesIgnore("src/node_modules/lib.js", p)).toBe(true);
    expect(matchesIgnore("src/foo.js", p)).toBe(false);
  });

  it("matches a literal path", () => {
    const p = parseIgnoreFile("/docs/archive/legacy");
    expect(matchesIgnore("docs/archive/legacy", p)).toBe(true);
    expect(matchesIgnore("docs/archive/legacy/x.md", p)).toBe(false);
  });

  it("matches a suffix pattern", () => {
    const p = parseIgnoreFile("*.tsbuildinfo");
    expect(matchesIgnore("dist/foo.tsbuildinfo", p)).toBe(true);
    expect(matchesIgnore("dist/foo.ts", p)).toBe(false);
  });

  it("normalises backslashes", () => {
    const p = parseIgnoreFile("node_modules/");
    expect(matchesIgnore("src\\node_modules\\lib.js", p)).toBe(true);
  });

  it("returns false for empty path input", () => {
    const p = parseIgnoreFile("node_modules/");
    expect(matchesIgnore("", p)).toBe(false);
  });
});

describe("mergeIgnorePatterns + defaultIgnorePatterns", () => {
  it("merges multiple pattern sets", () => {
    const a = parseIgnoreFile("node_modules/\n");
    const b = parseIgnoreFile("dist/\n*.coverage\n");
    const merged = mergeIgnorePatterns(a, b);
    expect(merged.directoryNames.has("node_modules")).toBe(true);
    expect(merged.directoryNames.has("dist")).toBe(true);
    expect(merged.suffixPatterns).toContain(".coverage");
  });

  it("defaultIgnorePatterns includes the canonical Nexus baseline", () => {
    const defaults = defaultIgnorePatterns();
    expect(defaults.directoryNames.has("node_modules")).toBe(true);
    expect(defaults.directoryNames.has(".git")).toBe(true);
    expect(defaults.directoryNames.has("dist")).toBe(true);
    expect(defaults.suffixPatterns).toContain(".tsbuildinfo");
  });

  it("NEXUS_IGNORE_DEFAULTS is exposed for downstream consumers", () => {
    expect(NEXUS_IGNORE_DEFAULTS).toContain("node_modules");
    expect(NEXUS_IGNORE_DEFAULTS).toContain("coverage");
    expect(NEXUS_IGNORE_DEFAULTS).toContain("*.tsbuildinfo");
  });
});
