/**
 * Integration test: skill loading and $ARGUMENTS substitution.
 *
 * These tests use the real built-in catalog on disk and do not mock fs.
 * They are tagged @integration but run without an Ollama server.
 */

import * as path from "path";
import * as url from "url";
import { describe, it, expect } from "vitest";
import { SkillLoader } from "../../../src/skills/SkillLoader.js";

// Resolve the catalog directory relative to this test file.
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const CATALOG_DIR = path.resolve(__dirname, "../../../src/skills/catalog");

describe("Built-in skill catalog integration", () => {
  it("loads the commit skill correctly", () => {
    const loader = new SkillLoader(CATALOG_DIR, path.join(CATALOG_DIR, "__nonexistent_user__"));
    loader.load();

    const skill = loader.getSkill("commit");
    expect(skill).toBeDefined();
    expect(skill?.name).toBe("commit");
    expect(skill?.description).toMatch(/commit/i);
    expect(skill?.prompt.length).toBeGreaterThan(50);
  });

  it("$ARGUMENTS substitution replaces the placeholder with the provided argument string", () => {
    const loader = new SkillLoader(CATALOG_DIR, path.join(CATALOG_DIR, "__nonexistent_user__"));
    loader.load();

    const skill = loader.getSkill("commit");
    expect(skill).toBeDefined();

    const args = "fix login regression on mobile";
    const expanded = skill!.prompt.replace(/\$ARGUMENTS/g, args);
    expect(expanded).toContain(args);
    expect(expanded).not.toContain("$ARGUMENTS");
  });

  it("lists all seven built-in skills", () => {
    const loader = new SkillLoader(CATALOG_DIR, path.join(CATALOG_DIR, "__nonexistent_user__"));
    loader.load();

    const names = loader.listSkills().map((s) => s.name);
    const expected = [
      "commit",
      "review-pr",
      "generate-readme",
      "generate-changelog",
      "generate-tests",
      "analyze-codebase",
      "setup-project",
    ];

    for (const name of expected) {
      expect(names).toContain(name);
    }
    expect(names.length).toBe(expected.length);
  });

  it("every built-in skill has a non-empty prompt body", () => {
    const loader = new SkillLoader(CATALOG_DIR, path.join(CATALOG_DIR, "__nonexistent_user__"));
    loader.load();

    for (const skill of loader.listSkills()) {
      expect(skill.prompt.trim().length, `${skill.name} has empty prompt`).toBeGreaterThan(0);
    }
  });
});
