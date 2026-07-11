/**
 * v1.5.0 Phase 7 (HUB.P3.RULES) -- consume the Nexus-Hub language rules.
 *
 * The Hub ships per-language coding rules under `catalog/rules/<lang>/` (one
 * `code-style.md`, `security.md`, and `testing.md` per language). They were
 * sparse-cloned by the skills syncer but never reached the prompt. This module
 * detects the workspace's primary language and renders the matching rules into
 * a single, length-bounded system-prompt section.
 *
 * The PromptBuilder consumes the *resolved string* via `PromptContext.languageRules`
 * (the builder never touches the filesystem), keeping prompt assembly pure and
 * the feature opt-in: when no language is detected or the rules root is absent,
 * `resolveLanguageRules` returns `null` and no section is added.
 */

import * as fs from "node:fs";
import * as path from "node:path";

/** Languages the Hub ships rules for (one directory each under catalog/rules). */
export type RuleLanguage = "bash" | "go" | "python" | "typescript";

export const RULE_LANGUAGES: readonly RuleLanguage[] = ["bash", "go", "python", "typescript"];

/** Rule files per language, in render order. */
const RULE_FILES: readonly string[] = ["code-style.md", "security.md", "testing.md"];

/** Default cap on the rendered section (chars). Keeps the prompt budget sane. */
export const DEFAULT_MAX_RULE_CHARS = 6000;

/**
 * Marker config files that identify a workspace's primary language, checked in
 * priority order. Go/Python/TypeScript are config-file detectable; bash is the
 * fallback only when a shell-project marker is present (it is rarely a repo's
 * primary language, so it is deliberately last and narrow).
 */
const LANGUAGE_MARKERS: ReadonlyArray<{ lang: RuleLanguage; files: readonly string[] }> = [
  { lang: "go", files: ["go.mod"] },
  { lang: "python", files: ["pyproject.toml", "requirements.txt", "setup.py", "setup.cfg", "Pipfile"] },
  { lang: "typescript", files: ["tsconfig.json", "package.json"] },
  { lang: "bash", files: ["bin/activate.sh", ".bashrc"] },
];

/**
 * Detect the workspace's primary language from marker files at its root.
 * Returns `null` when nothing recognizable is present (no rules are injected).
 */
export function detectPrimaryLanguage(
  workspacePath: string | undefined,
  existsSync: (p: string) => boolean = fs.existsSync,
): RuleLanguage | null {
  if (!workspacePath) return null;
  for (const marker of LANGUAGE_MARKERS) {
    for (const f of marker.files) {
      if (existsSync(path.join(workspacePath, f))) return marker.lang;
    }
  }
  return null;
}

/**
 * Load and render the Hub rules for `lang` from `rulesRoot` (the directory that
 * contains the per-language subdirectories, e.g.
 * `<active-nexus-hub>/catalog/rules`). Concatenates the available rule files
 * under a section header, truncating to `maxChars`. Returns `null` when the
 * language directory has no readable rule files.
 */
export function loadLanguageRules(
  rulesRoot: string,
  lang: RuleLanguage,
  opts: { maxChars?: number; readFile?: (p: string) => string } = {},
): string | null {
  const maxChars = opts.maxChars ?? DEFAULT_MAX_RULE_CHARS;
  const readFile =
    opts.readFile ?? ((p: string) => fs.readFileSync(p, "utf-8"));
  const langDir = path.join(rulesRoot, lang);
  const parts: string[] = [];
  for (const file of RULE_FILES) {
    let body: string;
    try {
      body = readFile(path.join(langDir, file)).trim();
    } catch {
      continue; // missing rule file -- skip
    }
    if (body) parts.push(body);
  }
  if (parts.length === 0) return null;

  const header = `## ${lang} project rules (from the skill catalog)\n\nThe following rules are authoritative for ${lang} code in this workspace. Honor them unless the user explicitly overrides.`;
  let rendered = `${header}\n\n${parts.join("\n\n")}`;
  if (rendered.length > maxChars) {
    rendered = rendered.slice(0, maxChars).trimEnd() + "\n\n[rules truncated]";
  }
  return rendered;
}

/**
 * End-to-end resolve: detect the workspace language and load its rules from
 * `rulesRoot`. Returns `null` (no section) when either step yields nothing.
 */
export function resolveLanguageRules(opts: {
  workspacePath: string | undefined;
  rulesRoot: string | undefined;
  maxChars?: number;
  existsSync?: (p: string) => boolean;
  readFile?: (p: string) => string;
}): string | null {
  if (!opts.rulesRoot) return null;
  const lang = detectPrimaryLanguage(opts.workspacePath, opts.existsSync);
  if (!lang) return null;
  return loadLanguageRules(opts.rulesRoot, lang, {
    maxChars: opts.maxChars,
    readFile: opts.readFile,
  });
}
