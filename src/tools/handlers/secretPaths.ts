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
 * Each entry is a simple glob: `**\/` means "at any depth", `*` means "any
 * characters except path separator". Matching is case-insensitive on Windows
 * and case-sensitive elsewhere.
 */
export const SECRET_PATH_PATTERNS: readonly string[] = [
  "**/.env*",
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

function globToRegex(glob: string): RegExp {
  let re = "^";
  let i = 0;
  while (i < glob.length) {
    const c = glob[i]!;
    if (c === "*") {
      if (glob[i + 1] === "*") {
        // ** — any characters including path separators
        re += "(?:.*)";
        i += 2;
        if (glob[i] === "/") i += 1; // consume trailing slash (so **/ matches zero-or-more directories)
      } else {
        // * — any characters except path separators
        re += "[^/\\\\]*";
        i += 1;
      }
      continue;
    }
    if (".?+()|[]{}^$\\".includes(c)) {
      re += "\\" + c;
    } else {
      re += c;
    }
    i += 1;
  }
  re += "$";
  return new RegExp(re, process.platform === "win32" ? "i" : "");
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
    const re = globToRegex(pattern);
    if (re.test(normalized)) return true;
  }
  return false;
}
