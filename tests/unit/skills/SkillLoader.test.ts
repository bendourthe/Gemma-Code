import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SkillLoader } from "../../../src/skills/SkillLoader.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "gemma-skill-test-"));
}

function writeSkill(
  dir: string,
  skillName: string,
  frontmatter: Record<string, string>,
  body: string
): void {
  const skillDir = path.join(dir, skillName);
  fs.mkdirSync(skillDir, { recursive: true });

  const fmLines = Object.entries(frontmatter)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
  const content = `---\n${fmLines}\n---\n${body}`;
  fs.writeFileSync(path.join(skillDir, "SKILL.md"), content, "utf-8");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SkillLoader", () => {
  let catalogDir: string;
  let userDir: string;

  beforeEach(() => {
    catalogDir = makeTmpDir();
    userDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(catalogDir, { recursive: true, force: true });
    fs.rmSync(userDir, { recursive: true, force: true });
  });

  it("loads a valid SKILL.md into a Skill object", () => {
    writeSkill(
      catalogDir,
      "commit",
      { name: "commit", description: "Generate a commit message", "argument-hint": "[msg]" },
      "Generate a commit message for $ARGUMENTS."
    );

    const loader = new SkillLoader(catalogDir, userDir);
    loader.load();

    const skill = loader.getSkill("commit");
    expect(skill).toBeDefined();
    expect(skill?.name).toBe("commit");
    expect(skill?.description).toBe("Generate a commit message");
    expect(skill?.argumentHint).toBe("[msg]");
    expect(skill?.prompt).toBe("Generate a commit message for $ARGUMENTS.");
  });

  it("returns undefined for a skill that does not exist", () => {
    const loader = new SkillLoader(catalogDir, userDir);
    loader.load();
    expect(loader.getSkill("nonexistent")).toBeUndefined();
  });

  it("rejects a SKILL.md with missing frontmatter fields and logs a warning", () => {
    // Missing 'description' field.
    writeSkill(catalogDir, "bad-skill", { name: "bad-skill" }, "Prompt body.");

    const loader = new SkillLoader(catalogDir, userDir);
    loader.load();

    expect(loader.getSkill("bad-skill")).toBeUndefined();
    expect(loader.listSkills()).toHaveLength(0);
  });

  it("rejects a SKILL.md with no frontmatter block", () => {
    const skillDir = path.join(catalogDir, "naked");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), "Just a body, no frontmatter.", "utf-8");

    const loader = new SkillLoader(catalogDir, userDir);
    loader.load();

    expect(loader.getSkill("naked")).toBeUndefined();
  });

  it("listSkills() includes both built-in and user skills", () => {
    writeSkill(
      catalogDir,
      "commit",
      { name: "commit", description: "Commit" },
      "Commit prompt."
    );
    writeSkill(
      userDir,
      "my-skill",
      { name: "my-skill", description: "Custom skill" },
      "Custom prompt."
    );

    const loader = new SkillLoader(catalogDir, userDir);
    loader.load();

    const names = loader.listSkills().map((s) => s.name);
    expect(names).toContain("commit");
    expect(names).toContain("my-skill");
  });

  it("user skills with the same name override built-in skills", () => {
    writeSkill(
      catalogDir,
      "commit",
      { name: "commit", description: "Built-in commit" },
      "Built-in prompt."
    );
    writeSkill(
      userDir,
      "commit",
      { name: "commit", description: "User commit" },
      "User prompt."
    );

    const loader = new SkillLoader(catalogDir, userDir);
    loader.load();

    const skill = loader.getSkill("commit");
    expect(skill?.description).toBe("User commit");
    expect(skill?.prompt).toBe("User prompt.");
  });

  it("creates the user skills directory if it does not exist", () => {
    const missingDir = path.join(os.tmpdir(), `gemma-missing-${Date.now()}`);
    const loader = new SkillLoader(catalogDir, missingDir);
    loader.load();

    expect(fs.existsSync(missingDir)).toBe(true);
    fs.rmSync(missingDir, { recursive: true, force: true });
  });

  it("hot-reload fires when a new skill is added to the watch directory", async () => {
    const loader = new SkillLoader(catalogDir, userDir);
    loader.load();
    loader.watch();

    expect(loader.getSkill("hot-skill")).toBeUndefined();

    // Write a new skill to the user directory.
    writeSkill(
      userDir,
      "hot-skill",
      { name: "hot-skill", description: "Hot-loaded skill" },
      "Hot prompt."
    );

    // Wait briefly for the fs.watch callback to fire and reload.
    await new Promise<void>((resolve) => setTimeout(resolve, 200));

    loader.stopWatching();

    const skill = loader.getSkill("hot-skill");
    expect(skill).toBeDefined();
    expect(skill?.name).toBe("hot-skill");
  });
});
