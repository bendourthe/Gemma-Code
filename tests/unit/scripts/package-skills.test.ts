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

  // v0.8.0 Phase 2 (item D1) -- extended agentskills.io schema. The
  // mirror parser exposes a `normalized` object so harness adapters can
  // round-trip the new fields without re-parsing the raw frontmatter.

  it("normalizes the extended schema with sensible defaults", () => {
    const raw = `---\nname: foo\ndescription: A skill\nargument-hint: "[arg]"\n---\nbody`;
    const { normalized } = parseSkill(raw);
    expect(normalized.version).toBe("1.0.0");
    expect(normalized.platforms).toEqual(["linux", "macos", "windows"]);
    expect(normalized.metadata.tags).toEqual([]);
    expect(normalized.metadata.relatedSkills).toEqual([]);
  });

  it("parses explicit version, platforms, and metadata fields", () => {
    const raw = [
      "---",
      "name: foo",
      "description: A skill",
      "argument-hint: [arg]",
      "version: 2.3.4",
      "platforms: [linux, macos]",
      "metadata.tags: [git, docs]",
      "metadata.related_skills: [bar, baz]",
      "---",
      "body",
    ].join("\n");
    const { normalized } = parseSkill(raw);
    expect(normalized.version).toBe("2.3.4");
    expect(normalized.platforms).toEqual(["linux", "macos"]);
    expect(normalized.metadata.tags).toEqual(["git", "docs"]);
    expect(normalized.metadata.relatedSkills).toEqual(["bar", "baz"]);
  });

  it("round-trips every harness adapter without losing the normalized fields", () => {
    const raw = [
      "---",
      "name: roundtrip",
      "description: A skill",
      "argument-hint: [arg]",
      "version: 1.5.0",
      "platforms: [linux]",
      "metadata.tags: [t1, t2]",
      "metadata.related_skills: [r1]",
      "---",
      "Body of skill",
    ].join("\n");
    const before = parseSkill(raw).normalized;
    for (const harness of HARNESSES) {
      const rendered = harness.render(raw, "roundtrip");
      // After render, the bytes may differ (cursor adapter rewrites the
      // frontmatter), but `parseSkill` should still recover the
      // normalized fields when the harness left them in the frontmatter.
      // For cursor specifically the original fields are preserved as
      // comments; we accept that the normalized fields can be empty for
      // cursor and assert on the other three.
      if (harness.id === "cursor") continue;
      const after = parseSkill(rendered).normalized;
      expect(after.version, `${harness.id} lost version`).toBe(before.version);
      expect(after.platforms, `${harness.id} lost platforms`).toEqual(before.platforms);
      expect(after.metadata.tags, `${harness.id} lost tags`).toEqual(before.metadata.tags);
      expect(after.metadata.relatedSkills, `${harness.id} lost related_skills`).toEqual(
        before.metadata.relatedSkills,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// renderCursor
// ---------------------------------------------------------------------------

describe("renderCursor", () => {
  it("emits Cursor-native frontmatter (description / globs / alwaysApply)", () => {
    const raw = `---\nname: commit\ndescription: A skill\n---\nBody\n`;
    const out = renderCursor(raw, "commit");
    expect(out.startsWith("---\n")).toBe(true);
    expect(out).toContain('description: "A skill"');
    expect(out).toContain("globs: ['**/*']");
    expect(out).toContain("alwaysApply: false");
  });

  it("preserves the body verbatim", () => {
    const raw = `---\nname: foo\ndescription: A skill\n---\nThis is the body.\n`;
    const out = renderCursor(raw, "foo");
    expect(out).toContain("This is the body.");
  });

  it("honours metadata.globs when declared in the frontmatter", () => {
    const raw = `---\nname: foo\ndescription: bar\nmetadata.globs: [src/**/*.ts, src/**/*.tsx]\n---\nbody`;
    const out = renderCursor(raw, "foo");
    expect(out).toContain("globs: ['src/**/*.ts', 'src/**/*.tsx']");
  });

  it("escapes embedded double quotes in description", () => {
    const raw = `---\nname: foo\ndescription: He said "hello"\n---\nbody`;
    const out = renderCursor(raw, "foo");
    expect(out).toContain('description: "He said \\"hello\\""');
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
    expect(md).toContain("modules/coding/skills/catalog/");
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
      ".cursor/rules/foo.mdc",
    );
  });

  it("renders claude-code / opencode / gemini-cli as byte-identical copies", () => {
    const raw = `---\nname: foo\n---\nbody`;
    const byId = Object.fromEntries(HARNESSES.map((h: { id: string }) => [h.id, h]));
    expect(byId["claude-code"].render(raw, "foo")).toBe(raw);
    expect(byId["opencode"].render(raw, "foo")).toBe(raw);
    expect(byId["gemini-cli"].render(raw, "foo")).toBe(raw);
  });

  it("no longer flags cursor with a warn flag (v0.8.0 Phase 6.A native .mdc)", () => {
    const cursor = HARNESSES.find((h: { id: string }) => h.id === "cursor");
    expect(cursor.warn).toBeUndefined();
  });

  it("fixture-roundtrip: cursor .mdc parses back to the original description", () => {
    const raw = `---\nname: foo\ndescription: A useful skill\nargument-hint: "[arg]"\n---\nBody content.\n`;
    const cursor = HARNESSES.find((h: { id: string }) => h.id === "cursor");
    const out = cursor.render(raw, "foo");
    const reparsed = parseSkill(out);
    expect(reparsed.frontmatter.description).toBe("A useful skill");
    expect(reparsed.frontmatter.globs).toBe("['**/*']");
    expect(reparsed.frontmatter.alwaysApply).toBe("false");
    expect(reparsed.body).toContain("Body content.");
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
  it("runs against modules/coding/skills/catalog/ and writes a per-harness tree", async () => {
    // Run with --quiet so stdout stays compact; we only need exit code and
    // file presence to confirm the end-to-end shape.
    const r = await runScript(["--quiet"]);
    expect(r.exitCode).toBe(0);

    const distRoot = path.join(REPO_ROOT, "dist");

    // Sample one skill from the catalog to confirm the output exists for
    // every harness.
    const catalogDir = path.join(REPO_ROOT, "modules", "coding", "skills", "catalog");
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
      fs.existsSync(path.join(distRoot, "cursor", ".cursor", "rules", `${sample}.mdc`)),
    ).toBe(true);

    for (const harness of ["claude-code", "opencode", "gemini-cli", "cursor"]) {
      expect(fs.existsSync(path.join(distRoot, harness, "README.md"))).toBe(true);
    }
  });
});
