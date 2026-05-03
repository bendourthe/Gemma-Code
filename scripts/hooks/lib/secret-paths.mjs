/**
 * Canonical list of glob patterns matching filesystem paths that may contain
 * secrets. Mirrored by `src/utils/secretPaths.ts` (which re-imports
 * the array). Keep this file as the single source of truth so the agent-agnostic
 * harness hooks and the in-process runtime guard cannot drift apart.
 *
 * Glob semantics:
 *   - `**` matches any characters including path separators (zero-or-more dirs).
 *   - `*` matches any characters except a path separator.
 *   - All other characters are literal; the path is matched against the full
 *     normalised string (forward slashes only).
 *
 * Matching is case-insensitive on Windows and case-sensitive elsewhere.
 */
export const SECRET_PATH_PATTERNS = Object.freeze([
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
]);

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
