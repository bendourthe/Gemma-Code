import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as url from "url";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SkillLoader } from "../../../modules/coding/skills/SkillLoader.js";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const REAL_CATALOG_DIR = path.resolve(__dirname, "../../../modules/coding/skills/catalog");

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

    // Poll deterministically for the fs.watch callback to reload the skill.
    await vi.waitFor(
      () => {
        const s = loader.getSkill("hot-skill");
        expect(s).toBeDefined();
        expect(s?.name).toBe("hot-skill");
      },
      { timeout: 2000, interval: 20 },
    );

    loader.stopWatching();

    const skill = loader.getSkill("hot-skill");
    expect(skill).toBeDefined();
    expect(skill?.name).toBe("hot-skill");
  });
});

// ---------------------------------------------------------------------------
// v0.7.0 Phase 1 -- skill expansion
// Asserts each of the 6 new skill MD files loads cleanly with a non-empty
// description and prompt. Reads the real on-disk catalog so a malformed
// frontmatter ships as a test failure rather than a silent skip.
// ---------------------------------------------------------------------------

describe("v0.7.0 skill expansion", () => {
  const newSkills = [
    "polish",
    "critique",
    "distill",
    "harden",
    "animate",
    "build-second-brain",
  ];

  for (const name of newSkills) {
    it(`loads "${name}" with non-empty description and prompt`, () => {
      const loader = new SkillLoader(
        REAL_CATALOG_DIR,
        path.join(REAL_CATALOG_DIR, "__nonexistent_user__")
      );
      loader.load();

      const skill = loader.getSkill(name);
      expect(skill, `${name} did not load from the catalog`).toBeDefined();
      expect(skill?.name).toBe(name);
      expect(skill?.description.trim().length).toBeGreaterThan(0);
      expect(skill?.prompt.trim().length).toBeGreaterThan(0);
    });
  }

  it("every new skill has an argument-hint declared", () => {
    const loader = new SkillLoader(
      REAL_CATALOG_DIR,
      path.join(REAL_CATALOG_DIR, "__nonexistent_user__")
    );
    loader.load();

    for (const name of newSkills) {
      const skill = loader.getSkill(name);
      expect(skill?.argumentHint, `${name} missing argument-hint`).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// v0.8.0 Phase 2 (item D1) -- agentskills.io schema extension
// ---------------------------------------------------------------------------

describe("v0.8.0 SKILL.md schema extension", () => {
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

  it("parses the full extended schema", () => {
    writeSkill(
      catalogDir,
      "fancy",
      {
        name: "fancy",
        description: "Does a thing",
        "argument-hint": "[arg]",
        version: "2.1.3",
        platforms: "[linux, macos]",
        "metadata.tags": "[git, workflow, docs]",
        "metadata.related_skills": "[commit, polish]",
      },
      "Body",
    );

    const loader = new SkillLoader(catalogDir, userDir);
    loader.load();
    const skill = loader.getSkill("fancy");

    expect(skill?.version).toBe("2.1.3");
    expect(skill?.platforms).toEqual(["linux", "macos"]);
    expect(skill?.metadata.tags).toEqual(["git", "workflow", "docs"]);
    expect(skill?.metadata.relatedSkills).toEqual(["commit", "polish"]);
  });

  it("applies forward-compatible defaults when the new fields are missing", () => {
    writeSkill(
      catalogDir,
      "legacy",
      { name: "legacy", description: "Old skill", "argument-hint": "[arg]" },
      "Body",
    );

    const loader = new SkillLoader(catalogDir, userDir);
    loader.load();
    const skill = loader.getSkill("legacy");

    expect(skill?.version).toBe("1.0.0");
    expect(skill?.platforms).toEqual(["linux", "macos", "windows"]);
    expect(skill?.metadata.tags).toEqual([]);
    expect(skill?.metadata.relatedSkills).toEqual([]);
  });

  it("parses optional pathScope frontmatter (gap 5.2.P3.Q)", () => {
    writeSkill(
      catalogDir,
      "scoped",
      {
        name: "scoped",
        description: "Path-scoped skill",
        "argument-hint": "[arg]",
        "pathScope.include": "[src/**, lib/**]",
        "pathScope.exclude": "[src/legacy/**]",
      },
      "Body",
    );

    const loader = new SkillLoader(catalogDir, userDir);
    loader.load();
    const skill = loader.getSkill("scoped");

    expect(skill?.metadata.pathScope).toEqual({
      include: ["src/**", "lib/**"],
      exclude: ["src/legacy/**"],
    });
  });

  it("leaves pathScope undefined when no bounds are declared (global default)", () => {
    writeSkill(
      catalogDir,
      "global",
      { name: "global", description: "Global skill", "argument-hint": "[arg]" },
      "Body",
    );

    const loader = new SkillLoader(catalogDir, userDir);
    loader.load();
    expect(loader.getSkill("global")?.metadata.pathScope).toBeUndefined();
  });

  it("accepts comma-separated platforms without brackets", () => {
    writeSkill(
      catalogDir,
      "csv",
      {
        name: "csv",
        description: "Comma form",
        "argument-hint": "[x]",
        platforms: "linux, macos",
      },
      "Body",
    );

    const loader = new SkillLoader(catalogDir, userDir);
    loader.load();
    expect(loader.getSkill("csv")?.platforms).toEqual(["linux", "macos"]);
  });

  it("falls back to default platforms when all entries are unknown", () => {
    writeSkill(
      catalogDir,
      "bogus-platform",
      {
        name: "bogus-platform",
        description: "Bad platforms",
        "argument-hint": "[x]",
        platforms: "[atari, beos]",
      },
      "Body",
    );

    const loader = new SkillLoader(catalogDir, userDir);
    loader.load();
    expect(loader.getSkill("bogus-platform")?.platforms).toEqual(["linux", "macos", "windows"]);
  });

  it("real catalog skills load with extended fields", () => {
    const loader = new SkillLoader(
      REAL_CATALOG_DIR,
      path.join(REAL_CATALOG_DIR, "__nonexistent_user__"),
    );
    loader.load();
    const commit = loader.getSkill("commit");
    expect(commit?.version).toBe("1.0.0");
    expect(commit?.platforms.length).toBeGreaterThan(0);
    expect(commit?.metadata.tags.length).toBeGreaterThan(0);
    expect(loader.getSkill("training-recipe")?.name).toBe("training-recipe");
  });
});
