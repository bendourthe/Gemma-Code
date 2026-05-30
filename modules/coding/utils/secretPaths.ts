import { Minimatch } from "minimatch";
import { SECRET_PATH_PATTERNS } from "./generated/safetyConfig.generated.js";

/**
 * Patterns matching filesystem paths that may contain secrets and therefore
 * must not be read/listed/grepped without explicit user confirmation.
 *
 * **Canonical source**: the AUTHORED `[secrets]` section of
 * `nexus.security.toml` (the safety-config SSOT, v1.4.0 Phase 4 / A1). The
 * generator (`scripts/generate-tool-permission-table.mjs`) writes both this
 * runtime copy (via `generated/safetyConfig.generated.ts`, re-exported below)
 * and the agent-agnostic harness-hook copy at
 * `scripts/hooks/lib/secret-paths.mjs`. `tests/unit/hooks/secret-paths-sync.test.ts`
 * enforces equality of the two copies, and `npm run security:check` is the CI
 * drift gate. The runtime imports the generated artifact rather than the .mjs
 * because `scripts/**` is excluded from the packaged VS Code extension.
 *
 * Each entry is a standard glob: `**\/` means "at any depth", `*` means
 * "any characters except path separator". Matching is delegated to the
 * `minimatch` library, configured to honour dotfiles (`dot: true`) and to
 * be case-insensitive on Windows.
 */
export { SECRET_PATH_PATTERNS };

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
