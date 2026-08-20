/**
 * v1.2.0 Phase 5.3 -- shared `.nexusignore` parser.
 *
 * Provides a single source of truth for `.nexusignore` parsing across the
 * codebase. Pre-Phase-5, the codegraph scanner (`core/codegraph/scanner/
 * RepoScanner.ts`) shipped its own inline ignore parser; this module
 * generalises that surface so memory ingest, the Phase 6 file-watcher
 * abstraction, and the sub-agent Read / Glob tools can apply the same
 * exclusions consistently.
 *
 * Syntax mirrors `.gitignore` (the subset the regex-based path scanner
 * already supports):
 *
 *   - Blank lines and `#` comments are skipped.
 *   - `name/` -> directory exclusion (recursively excludes anything
 *     containing a path segment with that name).
 *   - `name` (no slash, no wildcard) -> directory-name match (same as
 *     `name/` in this subset).
 *   - `/path/to/thing` -> literal path-from-root.
 *   - `*.ext` -> file-extension suffix.
 *   - `path/with/slash` -> literal sub-path match.
 *   - `!pattern` -> negation. Currently SKIPPED with a note (the regex
 *     scanner uses negation rarely; the runtime falls back to "include"
 *     for any line starting with `!`). Tracked as a future enhancement.
 *
 * The parser is pure -- no filesystem access. Callers read the file
 * content themselves and pass it in. This keeps the module trivially
 * testable and decouples it from `fs` semantics on different platforms.
 */

export interface IgnorePatterns {
  /** Directory or file basenames that are excluded wherever they appear. */
  readonly directoryNames: ReadonlySet<string>;
  /** Repo-root-relative literal paths that are excluded. */
  readonly literalPaths: ReadonlySet<string>;
  /** File-extension suffixes (`.ext`) that are excluded. */
  readonly suffixPatterns: readonly string[];
}

/**
 * Default exclusions baked into Nexus regardless of whether `.nexusignore`
 * exists in the repo. Matches the set already filtered by Phase 3's
 * codegraph scanner and the existing test infra.
 */
export const NEXUS_IGNORE_DEFAULTS: readonly string[] = [
  "node_modules",
  ".git",
  ".nexus",
  ".gemma-code",
  "dist",
  "out",
  "build",
  ".turbo",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".cache",
  ".vite",
  ".parcel-cache",
  "coverage",
  ".nyc_output",
  "*.tsbuildinfo",
  "*.coverage",
  "project-sandboxes",
];

const EMPTY_PATTERNS: IgnorePatterns = Object.freeze({
  directoryNames: Object.freeze(new Set<string>()) as ReadonlySet<string>,
  literalPaths: Object.freeze(new Set<string>()) as ReadonlySet<string>,
  suffixPatterns: Object.freeze([]) as readonly string[],
});

/**
 * Parse a `.nexusignore` (or `.gitignore`) file body into the structured
 * form used by `matchesIgnore`. Returns the empty `IgnorePatterns` value
 * for an empty / null body so callers can blindly compose results.
 *
 * Multiple files can be merged via `mergeIgnorePatterns` -- the typical
 * pattern is to parse `.gitignore`, then `.nexusignore`, then merge them
 * together with the user's extra excludes.
 */
export function parseIgnoreFile(content: string | null | undefined): IgnorePatterns {
  if (!content) return EMPTY_PATTERNS;
  const directoryNames = new Set<string>();
  const literalPaths = new Set<string>();
  const suffixPatterns: string[] = [];

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    if (line.startsWith("#")) continue;
    // Negation is intentionally out-of-scope for the regex scanner.
    // Lines starting with `!` are skipped; the runtime treats them as
    // "include" (i.e. it never excludes them).
    if (line.startsWith("!")) continue;
    addPattern(line, directoryNames, literalPaths, suffixPatterns);
  }

  return Object.freeze({
    directoryNames: Object.freeze(directoryNames),
    literalPaths: Object.freeze(literalPaths),
    suffixPatterns: Object.freeze(suffixPatterns),
  });
}

/**
 * Merge two pattern sets (e.g. `.gitignore` + `.nexusignore`, or with
 * the user's extra excludes). Returns a new frozen `IgnorePatterns`.
 */
export function mergeIgnorePatterns(
  ...sets: readonly IgnorePatterns[]
): IgnorePatterns {
  const directoryNames = new Set<string>();
  const literalPaths = new Set<string>();
  const suffixPatterns: string[] = [];
  for (const s of sets) {
    for (const d of s.directoryNames) directoryNames.add(d);
    for (const p of s.literalPaths) literalPaths.add(p);
    for (const sfx of s.suffixPatterns) suffixPatterns.push(sfx);
  }
  return Object.freeze({
    directoryNames: Object.freeze(directoryNames),
    literalPaths: Object.freeze(literalPaths),
    suffixPatterns: Object.freeze(suffixPatterns),
  });
}

/**
 * Build the default ignore set (the `NEXUS_IGNORE_DEFAULTS` patterns
 * parsed into structured form). Used as the seed value before merging
 * with the user's `.nexusignore`.
 */
export function defaultIgnorePatterns(): IgnorePatterns {
  return parseIgnoreFile(NEXUS_IGNORE_DEFAULTS.join("\n"));
}

/**
 * Test whether a repo-root-relative path is ignored by the supplied
 * pattern set. Paths are normalised to forward slashes; absolute paths
 * are not supported (the caller relativises first).
 */
export function matchesIgnore(
  relativePath: string,
  patterns: IgnorePatterns,
): boolean {
  if (!relativePath) return false;
  const normalised = relativePath.replace(/\\/g, "/");

  // Path-segment match against directoryNames -- excludes any path that
  // contains a segment matching one of the directory names.
  if (patterns.directoryNames.size > 0) {
    const parts = normalised.split("/");
    for (const part of parts) {
      if (patterns.directoryNames.has(part)) return true;
    }
  }

  // Literal-path match (`/path/to/thing`).
  if (patterns.literalPaths.has(normalised)) return true;

  // Suffix-pattern match (`*.tsbuildinfo` -> `.tsbuildinfo`).
  for (const suffix of patterns.suffixPatterns) {
    if (normalised.endsWith(suffix)) return true;
  }

  return false;
}

function addPattern(
  pattern: string,
  directoryNames: Set<string>,
  literalPaths: Set<string>,
  suffixPatterns: string[],
): void {
  if (pattern.endsWith("/")) {
    directoryNames.add(pattern.slice(0, -1).replace(/^\//, ""));
    return;
  }
  if (pattern.startsWith("*.")) {
    suffixPatterns.push(pattern.slice(1));
    return;
  }
  if (pattern.startsWith("/")) {
    literalPaths.add(pattern.slice(1));
    return;
  }
  if (!pattern.includes("/") && !pattern.includes("*")) {
    directoryNames.add(pattern);
    return;
  }
  literalPaths.add(pattern);
}
