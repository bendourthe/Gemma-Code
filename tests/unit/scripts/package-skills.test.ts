/**
 * Unit tests for `scripts/package-skills.mjs`.
 *
 * The script is structured around four "harness adapters" (claude-code,
 * cursor, opencode, gemini-cli) plus a SKILL.md parser. We exercise each
 * adapter's transform deterministically against a synthetic catalog and
 * also run the end-to-end script via spawn against the real `src/skills/
 * catalog/` to confirm the output tree shape.
 */

import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// @ts-expect-error -- script export, no .d.ts by design.
import { HARNESSES, parseSkill, renderCursor, buildHarnessReadme } from "../../../scripts/package-skills.mjs";

const SCRIPT_PATH = path.resolve(__dirname, "../../../scripts/package-skills.mjs");
const REPO_ROOT = path.resolve(__dirname, "../../..");

// ---------------------------------------------------------------------------
// parseSkill
// ---------------------------------------------------------------------------

describe("parseSkill", () => {
  it("extracts frontmatter and body from a well-formed SKILL.md", () => {
    const raw = `---\nname: foo\ndescription: A test skill\nargument-hint: "[arg]"\n---\nBody line one.\nBody line two.\n`;
    const { frontmatter, body } = parseSkill(raw);
    expect(frontmatter.name).toBe("foo");
    expect(frontmatter.description).toBe("A test skill");
    expect(frontmatter["argument-hint"]).toBe("[arg]");
    expect(body.trim()).toBe("Body line one.\nBody line two.");
  });

  it("strips both single and double quotes from values", () => {
    const raw = `---\nname: 'foo'\ndescription: "bar"\n---\nbody`;
    const { frontmatter } = parseSkill(raw);
    expect(frontmatter.name).toBe("foo");
    expect(frontmatter.description).toBe("bar");
  });

  it("throws when the leading fence is missing", () => {
    expect(() => parseSkill("name: foo\n---\nbody")).toThrow(/leading/);
  });

  it("throws when the trailing fence is missing", () => {
    expect(() => parseSkill("---\nname: foo\nbody-without-fence")).toThrow(/trailing/);
  });

  it("ignores blank lines and comment lines inside the frontmatter", () => {
    const raw = `---\nname: foo\n\n# a comment\ndescription: bar\n---\nbody`;
    const { frontmatter } = parseSkill(raw);
    expect(frontmatter.description).toBe("bar");
  });
});

// ---------------------------------------------------------------------------
// renderCursor
// ---------------------------------------------------------------------------

describe("renderCursor", () => {
  it("replaces the SKILL frontmatter with a Cursor marker", () => {
    const raw = `---\nname: commit\ndescription: A skill\n---\nBody\n`;
    const out = renderCursor(raw, "commit");
    expect(out.startsWith("---\nrule: SKILL\nname: commit\n---\n")).toBe(true);
  });

  it("preserves the body verbatim", () => {
    const raw = `---\nname: foo\n---\nThis is the body.\n`;
    const out = renderCursor(raw, "foo");
    expect(out).toContain("This is the body.");
  });

  it("preserves the original frontmatter as comment lines", () => {
    const raw = `---\nname: foo\ndescription: bar\n---\nbody`;
    const out = renderCursor(raw, "foo");
    expect(out).toContain("# original: name:");
    expect(out).toContain("# original: description:");
  });
});

// ---------------------------------------------------------------------------
// buildHarnessReadme
// ---------------------------------------------------------------------------

describe("buildHarnessReadme", () => {
  it("includes the harness title, source pointer, and skill list", () => {
    const harness = HARNESSES.find((h: { id: string }) => h.id === "claude-code");
    const md = buildHarnessReadme(harness, ["alpha", "bravo", "charlie"]);
    expect(md).toContain("# Gemma Code skills exported for Claude Code");
    expect(md).toContain("src/skills/catalog/");
    expect(md).toContain("- alpha");
    expect(md).toContain("- bravo");
    expect(md).toContain("Skills (3)");
  });
});

// ---------------------------------------------------------------------------
// Harness adapter table
// ---------------------------------------------------------------------------

describe("HARNESSES adapter table", () => {
  it("ships all four expected harnesses", () => {
    const ids = HARNESSES.map((h: { id: string }) => h.id);
    expect(ids.sort()).toEqual(["claude-code", "cursor", "gemini-cli", "opencode"]);
  });

  it("emits the expected relative paths per harness", () => {
    const byId = Object.fromEntries(HARNESSES.map((h: { id: string }) => [h.id, h]));
    expect(byId["claude-code"].relativePath("foo").replace(/\\/g, "/")).toBe(
      ".claude/skills/foo/SKILL.md",
    );
    expect(byId["opencode"].relativePath("foo").replace(/\\/g, "/")).toBe(
      ".opencode/skills/foo/SKILL.md",
    );
    expect(byId["gemini-cli"].relativePath("foo").replace(/\\/g, "/")).toBe(
      ".gemini/skills/foo/SKILL.md",
    );
    expect(byId["cursor"].relativePath("foo").replace(/\\/g, "/")).toBe(
      ".cursor/rules/foo.md",
    );
  });

  it("renders claude-code / opencode / gemini-cli as byte-identical copies", () => {
    const raw = `---\nname: foo\n---\nbody`;
    const byId = Object.fromEntries(HARNESSES.map((h: { id: string }) => [h.id, h]));
    expect(byId["claude-code"].render(raw, "foo")).toBe(raw);
    expect(byId["opencode"].render(raw, "foo")).toBe(raw);
    expect(byId["gemini-cli"].render(raw, "foo")).toBe(raw);
  });

  it("marks the cursor adapter with the warn flag", () => {
    const cursor = HARNESSES.find((h: { id: string }) => h.id === "cursor");
    expect(cursor.warn).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// End-to-end spawn
// ---------------------------------------------------------------------------

interface RunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

function runScript(args: string[]): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SCRIPT_PATH, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: REPO_ROOT,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c.toString()));
    child.stderr.on("data", (c) => (stderr += c.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ exitCode: code, stdout, stderr }));
  });
}

describe("package-skills (spawn, real catalog)", () => {
  it("runs against src/skills/catalog/ and writes a per-harness tree", async () => {
    // Run with --quiet so stdout stays compact; we only need exit code and
    // file presence to confirm the end-to-end shape.
    const r = await runScript(["--quiet"]);
    expect(r.exitCode).toBe(0);

    const distRoot = path.join(REPO_ROOT, "dist");

    // Sample one skill from the catalog to confirm the output exists for
    // every harness.
    const catalogDir = path.join(REPO_ROOT, "src", "skills", "catalog");
    const skills = fs
      .readdirSync(catalogDir)
      .filter((n) => fs.statSync(path.join(catalogDir, n)).isDirectory());
    expect(skills.length).toBeGreaterThan(0);
    const sample = skills[0];

    expect(
      fs.existsSync(path.join(distRoot, "claude-code", ".claude", "skills", sample, "SKILL.md")),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(distRoot, "opencode", ".opencode", "skills", sample, "SKILL.md")),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(distRoot, "gemini-cli", ".gemini", "skills", sample, "SKILL.md")),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(distRoot, "cursor", ".cursor", "rules", `${sample}.md`)),
    ).toBe(true);

    for (const harness of ["claude-code", "opencode", "gemini-cli", "cursor"]) {
      expect(fs.existsSync(path.join(distRoot, harness, "README.md"))).toBe(true);
    }
  });
});
