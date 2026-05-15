#!/usr/bin/env node
/**
 * Package the gemma-code skill catalog for four sibling agentic harnesses
 * (Claude Code, Cursor, OpenCode, Gemini CLI) so users can drop the same
 * skills into whichever tool they already run.
 *
 * Inputs: src/skills/catalog/<skill-name>/SKILL.md
 * Outputs (relative to repo root, all under dist/):
 *   - dist/claude-code/.claude/skills/<skill-name>/SKILL.md  -- copy as-is
 *   - dist/cursor/.cursor/rules/<skill-name>.md              -- transformed
 *   - dist/opencode/.opencode/skills/<skill-name>/SKILL.md   -- copy as-is
 *   - dist/gemini-cli/.gemini/skills/<skill-name>/SKILL.md   -- copy as-is
 *   - dist/<harness>/README.md                               -- usage note
 *
 * Each harness directory is rebuilt from scratch on every run so the output
 * is deterministic with respect to the catalog contents. The dist/ tree is
 * gitignored; release CI zips each subtree as an artifact.
 *
 * Claude Code, OpenCode, and Gemini CLI consume the Anthropic SKILL.md
 * schema verbatim (frontmatter `name` / `description` / `argument-hint`
 * plus a markdown body), so those three are byte-identical copies. Cursor's
 * native rule format is `.cursor/rules/<slug>.mdc` with frontmatter
 * `description` / `globs` / `alwaysApply` -- it differs enough that a real
 * 1:1 conversion is non-trivial. This script emits a best-effort `.md` file
 * with a minimal `rule: SKILL` frontmatter marker, logs a warning, and
 * defers a full Cursor-native conversion to a follow-up phase. The bundled
 * README.md inside dist/cursor/ documents the limitation for end-users.
 *
 * Run via: `node scripts/package-skills.mjs`
 *   --quiet      suppress per-skill log lines (final summary only)
 *   --no-clean   skip rm -rf of each harness output dir before writing
 *
 * Exit codes:
 *   0  -- success
 *   1  -- catalog directory missing or empty, or write error
 *   2  -- malformed SKILL.md (missing frontmatter)
 */

import {
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const CATALOG_DIR = join(REPO_ROOT, "src", "skills", "catalog");
const DIST_DIR = join(REPO_ROOT, "dist");

const ARGS = new Set(process.argv.slice(2));
const QUIET = ARGS.has("--quiet");
const NO_CLEAN = ARGS.has("--no-clean");

// ---------------------------------------------------------------------------
// Harness adapters
// ---------------------------------------------------------------------------

/**
 * Each adapter declares where its files land inside the per-harness dist
 * tree and how to shape one skill. The `render` function receives the raw
 * SKILL.md contents and the skill slug and returns the bytes to write.
 * `relativePath` resolves to the file path relative to the harness dist
 * root, e.g. `.claude/skills/commit/SKILL.md`.
 */
const HARNESSES = Object.freeze([
  {
    id: "claude-code",
    title: "Claude Code",
    relativePath: (slug) => join(".claude", "skills", slug, "SKILL.md"),
    render: (raw) => raw,
    schemaNote:
      "Claude Code reads .claude/skills/<slug>/SKILL.md verbatim, including the YAML frontmatter (`name`, `description`, optional `argument-hint`).",
  },
  {
    id: "opencode",
    title: "OpenCode",
    relativePath: (slug) => join(".opencode", "skills", slug, "SKILL.md"),
    render: (raw) => raw,
    schemaNote:
      "OpenCode follows the Anthropic SKILL.md schema and reads files at .opencode/skills/<slug>/SKILL.md.",
  },
  {
    id: "gemini-cli",
    title: "Gemini CLI",
    relativePath: (slug) => join(".gemini", "skills", slug, "SKILL.md"),
    render: (raw) => raw,
    schemaNote:
      "Gemini CLI follows the Anthropic SKILL.md schema and reads files at .gemini/skills/<slug>/SKILL.md.",
  },
  {
    id: "cursor",
    title: "Cursor",
    relativePath: (slug) => join(".cursor", "rules", `${slug}.md`),
    render: renderCursor,
    schemaNote:
      "Cursor's native rule format is .cursor/rules/<slug>.mdc with frontmatter `description` / `globs` / `alwaysApply`. The export below uses a placeholder `rule: SKILL` marker and preserves the original SKILL.md body; a fully-native Cursor rule conversion is tracked as a follow-up.",
    warn: true,
  },
]);

/**
 * Cursor-specific transform: replace the SKILL frontmatter block with a
 * minimal Cursor marker, preserving the original frontmatter fields as a
 * comment so they survive a roundtrip. We intentionally do not try to map
 * `argument-hint` onto Cursor's `globs` (the semantics differ); the result
 * is a "rule that mirrors the SKILL body" rather than a native Cursor rule.
 */
function renderCursor(raw, slug) {
  const { frontmatter, body } = parseSkill(raw);
  const frontmatterLines = Object.entries(frontmatter).map(
    ([k, v]) => `# original: ${k}: ${JSON.stringify(v)}`,
  );
  const header = [
    "---",
    "rule: SKILL",
    `name: ${slug}`,
    "---",
    "",
    "<!--",
    "  Gemma Code SKILL exported for Cursor. The native Cursor rule format",
    "  is .cursor/rules/<slug>.mdc with `description` / `globs` / `alwaysApply`",
    "  frontmatter; this file mirrors the Anthropic SKILL.md body verbatim",
    "  so the rule remains readable. Original frontmatter is preserved",
    "  below as comments.",
    ...frontmatterLines.map((line) => `  ${line}`),
    "-->",
    "",
  ];
  return `${header.join("\n")}${body}`;
}

// ---------------------------------------------------------------------------
// SKILL.md parsing
// ---------------------------------------------------------------------------

/**
 * Tiny frontmatter parser. SKILL.md frontmatter is a `---`-fenced YAML-ish
 * block with one `key: value` per line. Quotes around values are stripped.
 * Returns `{ frontmatter, body }`; throws if the fences are missing.
 */
function parseSkill(raw) {
  if (!raw.startsWith("---\n")) {
    throw new Error("SKILL.md is missing the leading `---` frontmatter fence");
  }
  const end = raw.indexOf("\n---\n", 4);
  if (end === -1) {
    throw new Error("SKILL.md is missing the trailing `---` frontmatter fence");
  }
  const blockLines = raw.slice(4, end).split("\n");
  const frontmatter = {};
  for (const line of blockLines) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    let value = line.slice(colon + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    frontmatter[key] = value;
  }
  const body = raw.slice(end + "\n---\n".length);
  return { frontmatter, body };
}

// ---------------------------------------------------------------------------
// I/O helpers
// ---------------------------------------------------------------------------

function log(msg) {
  if (!QUIET) process.stdout.write(`${msg}\n`);
}

function warn(msg) {
  process.stderr.write(`WARN: ${msg}\n`);
}

function die(code, msg) {
  process.stderr.write(`ERROR: ${msg}\n`);
  process.exit(code);
}

function listSkillSlugs() {
  if (!existsSync(CATALOG_DIR)) {
    die(1, `catalog directory not found: ${CATALOG_DIR}`);
  }
  const entries = readdirSync(CATALOG_DIR)
    .filter((name) => {
      const full = join(CATALOG_DIR, name);
      return statSync(full).isDirectory() && existsSync(join(full, "SKILL.md"));
    })
    .sort();
  if (entries.length === 0) {
    die(1, `no skills found in ${CATALOG_DIR}`);
  }
  return entries;
}

function buildHarnessReadme(harness, skillSlugs) {
  const lines = [
    `# Gemma Code skills exported for ${harness.title}`,
    "",
    "These are the Gemma Code skill files, exported automatically from the",
    "gemma-code source tree. Updates are mirrored on each gemma-code release;",
    "do not edit in place -- changes will be overwritten on the next export.",
    "",
    "## Source",
    "",
    "Generated from `src/skills/catalog/` in https://github.com/bendourthe/Gemma-Code",
    "by `scripts/package-skills.mjs`.",
    "",
    "## Schema",
    "",
    harness.schemaNote,
    "",
    "## Installation",
    "",
    `Copy the contents of this directory (\`${harness.id}/\`) into the root of`,
    "the workspace where you want the skills available.",
    "",
    `## Skills (${skillSlugs.length})`,
    "",
    ...skillSlugs.map((slug) => `- ${slug}`),
    "",
  ];
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const skillSlugs = listSkillSlugs();
  const skillContents = new Map();
  for (const slug of skillSlugs) {
    const raw = readFileSync(join(CATALOG_DIR, slug, "SKILL.md"), "utf-8");
    try {
      parseSkill(raw);
    } catch (err) {
      die(2, `${slug}/SKILL.md: ${err instanceof Error ? err.message : String(err)}`);
    }
    skillContents.set(slug, raw);
  }

  if (!existsSync(DIST_DIR)) mkdirSync(DIST_DIR, { recursive: true });

  for (const harness of HARNESSES) {
    const harnessRoot = join(DIST_DIR, harness.id);
    if (!NO_CLEAN && existsSync(harnessRoot)) {
      rmSync(harnessRoot, { recursive: true, force: true });
    }
    mkdirSync(harnessRoot, { recursive: true });

    if (harness.warn) {
      warn(
        `${harness.id}: schema differs from gemma-code's SKILL.md; emitting best-effort transform (see dist/${harness.id}/README.md).`,
      );
    }

    for (const slug of skillSlugs) {
      const raw = skillContents.get(slug);
      const out = harness.render(raw, slug);
      const relPath = harness.relativePath(slug);
      const outPath = join(harnessRoot, relPath);
      mkdirSync(dirname(outPath), { recursive: true });
      writeFileSync(outPath, out, "utf-8");
    }

    writeFileSync(
      join(harnessRoot, "README.md"),
      buildHarnessReadme(harness, skillSlugs),
      "utf-8",
    );
    log(`  ${harness.id}: wrote ${skillSlugs.length} skills`);
  }

  log("");
  log(
    `Packaged ${skillSlugs.length} skill(s) for ${HARNESSES.length} harness(es) into ${DIST_DIR}`,
  );
}

// Only run when invoked directly. When imported by tests, the helper
// exports below are used and `main()` is left to the test driver.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}

// Export the harness adapter table and the parser so unit tests can exercise
// each piece without spawning the script. The script's CLI entry above runs
// unconditionally; importers can ignore the side effect by mocking the
// catalog directory, or simply use the exports below.
export {
  HARNESSES,
  parseSkill,
  renderCursor,
  buildHarnessReadme,
  listSkillSlugs,
  CATALOG_DIR,
  DIST_DIR,
};
