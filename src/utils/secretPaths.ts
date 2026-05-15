import { Minimatch } from "minimatch";

/**
 * Patterns matching filesystem paths that may contain secrets and therefore
 * must not be read/listed/grepped without explicit user confirmation.
 *
 * **Canonical source**: `scripts/hooks/lib/secret-paths.mjs` is the
 * agent-agnostic, harness-facing source of truth. This array must stay in
 * lock-step with that file; `tests/unit/hooks/secret-paths-sync.test.ts`
 * enforces equality. The list is duplicated (rather than imported) because
 * `scripts/**` is excluded from the packaged VS Code extension, so the
 * bundled runtime cannot read the .mjs file from disk.
 *
 * Each entry is a standard glob: `**\/` means "at any depth", `*` means
 * "any characters except path separator". Matching is delegated to the
 * `minimatch` library, configured to honour dotfiles (`dot: true`) and to
 * be case-insensitive on Windows.
 */
export const SECRET_PATH_PATTERNS: readonly string[] = [
  "**/.env*", // gemma-check-allow: no-env-file-leakage
  "**/id_rsa*",
  "**/id_ed25519*",
  "**/id_ecdsa*",
  "**/*.pem",
  "**/*.key",
  "**/credentials*",
  "**/.aws/**",
  "**/.ssh/**",
  "**/secrets/**",
  "**/.gemma-code/mcp.json",
];

const MINIMATCH_OPTIONS = {
  matchBase: false,
  dot: true,
  nocase: process.platform === "win32",
} as const;

const matcherCache = new Map<string, Minimatch>();

function getMatcher(glob: string): Minimatch {
  let m = matcherCache.get(glob);
  if (!m) {
    m = new Minimatch(glob, MINIMATCH_OPTIONS);
    matcherCache.set(glob, m);
  }
  return m;
}

function normalize(p: string): string {
  return p.replace(/\\/g, "/");
}

/**
 * Returns true if `relativePath` matches any built-in or user-supplied secret
 * path pattern. The path must be workspace-relative (forward or back slashes).
 */
export function matchesSecretPath(
  relativePath: string,
  extraPatterns: readonly string[] = [],
): boolean {
  const normalized = normalize(relativePath);
  const patterns = [...SECRET_PATH_PATTERNS, ...extraPatterns];
  for (const pattern of patterns) {
    if (getMatcher(pattern).match(normalized)) return true;
  }
  return false;
}
