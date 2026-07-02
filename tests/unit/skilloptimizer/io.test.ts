import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fsp } from "node:fs";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { RootSkillPathResolver, fsSkillFileIO } from "../../../modules/coding/skilloptimizer/io.js";

/**
 * v1.7.0 Phase 3 (adoption-self-optimizing-skills S2 / SO003) -- unit tests for
 * the default, vscode-free guardrail seam implementations: the catalog-root
 * containment resolver (fail-closed on traversal) and the atomic file I/O.
 */

let root: string;

beforeEach(async () => {
  root = await fsp.mkdtemp(path.join(os.tmpdir(), "skillopt-io-"));
});

afterEach(async () => {
  await fsp.rm(root, { recursive: true, force: true });
});

describe("RootSkillPathResolver", () => {
  it("resolves a path inside the catalog root", () => {
    const resolver = new RootSkillPathResolver(root);
    const inside = path.join(root, "skill-x", "SKILL.md");
    expect(resolver.resolve(inside)).toBe(fs.realpathSync(root) + path.sep + path.join("skill-x", "SKILL.md"));
  });

  it("resolves a relative path against the root", () => {
    const resolver = new RootSkillPathResolver(root);
    const resolved = resolver.resolve(path.join("skill-y", "SKILL.md"));
    expect(resolved.startsWith(fs.realpathSync(root) + path.sep)).toBe(true);
  });

  it("throws on a path that escapes the catalog root (fail-closed)", () => {
    const resolver = new RootSkillPathResolver(root);
    const outside = path.resolve(root, "..", "elsewhere", "SKILL.md");
    expect(() => resolver.resolve(outside)).toThrow(/outside the skill catalog root/);
    expect(() => resolver.resolve(path.join("..", "..", "etc", "passwd"))).toThrow(/outside the skill catalog root/);
  });
});

describe("fsSkillFileIO", () => {
  it("round-trips a file, creating parent directories", () => {
    const target = path.join(root, "nested", "dir", "SKILL.md");
    fsSkillFileIO.write(target, "hello skill");
    expect(fsSkillFileIO.read(target)).toBe("hello skill");
    expect(fs.existsSync(target)).toBe(true);
  });

  it("overwrites an existing file atomically", () => {
    const target = path.join(root, "SKILL.md");
    fsSkillFileIO.write(target, "first");
    fsSkillFileIO.write(target, "second");
    expect(fsSkillFileIO.read(target)).toBe("second");
  });
});
