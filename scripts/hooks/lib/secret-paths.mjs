/**
 * Glob patterns matching filesystem paths that may contain secrets. This is the
 * agent-agnostic, harness-facing copy used by the hook scripts (which cannot
 * import the bundled .ts runtime, since `scripts/**` is excluded from the
 * packaged extension).
 *
 * v1.4.0 Phase 4 (A1): the array below is GENERATED from the AUTHORED
 * `[secrets]` section of `nexus.security.toml` by
 * `scripts/generate-tool-permission-table.mjs`. Do not edit it by hand; edit the
 * SSOT and run `npm run security:gen`. The same SSOT also drives the runtime
 * copy at `modules/coding/utils/generated/safetyConfig.generated.ts`;
 * `tests/unit/hooks/secret-paths-sync.test.ts` enforces equality of the two, and
 * `npm run security:check` is the CI drift gate.
 *
 * Glob semantics:
 *   - `**` matches any characters including path separators (zero-or-more dirs).
 *   - `*` matches any characters except a path separator.
 *   - All other characters are literal; the path is matched against the full
 *     normalised string (forward slashes only).
 *
 * Matching is case-insensitive on Windows and case-sensitive elsewhere.
 */
// BEGIN:GENERATED-SECRET-PATHS (from nexus.security.toml -- do not edit; run `npm run security:gen`)
export const SECRET_PATH_PATTERNS = Object.freeze([
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
  "**/.nexus/mcp.json",
]);
// END:GENERATED-SECRET-PATHS

function globToRegex(glob) {
  let re = "^";
  let i = 0;
  while (i < glob.length) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        re += "(?:.*)";
        i += 2;
        if (glob[i] === "/") i += 1;
      } else {
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

function normalize(p) {
  return String(p).replace(/\\/g, "/");
}

/**
 * Return true if `relativePath` matches any built-in or user-supplied secret
 * path pattern. The path must be workspace-relative; absolute paths should be
 * stripped of the workspace prefix by the caller before being passed here.
 *
 * @param {string} relativePath
 * @param {readonly string[]} [extraPatterns]
 * @returns {boolean}
 */
export function matchesSecretPath(relativePath, extraPatterns = []) {
  const normalized = normalize(relativePath);
  const patterns = [...SECRET_PATH_PATTERNS, ...extraPatterns];
  for (const pattern of patterns) {
    const re = globToRegex(pattern);
    if (re.test(normalized)) return true;
  }
  return false;
}
