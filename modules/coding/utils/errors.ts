/**
 * Centralized error formatting. Replaces the ad-hoc
 * `err instanceof Error ? err.message : String(err)` pattern that was
 * sprinkled across tool handlers and streaming code. Keeping this in one
 * place lets us:
 *
 *   1. Redact filesystem paths and known secret patterns before a message
 *      reaches the webview, so accidental leakage is harder.
 *   2. Evolve the formatting rules (e.g. include error codes, translate
 *      well-known errno values) without chasing every call site.
 *   3. Separate the user-facing surface from the developer-facing surface
 *      (stack traces, error class names, nested causes).
 */

/**
 * Characters that make up a local filesystem path on Windows or POSIX.
 * We intentionally match conservatively: anything that looks like a URL
 * or short token is left alone.
 */
const PATH_REGEX = /(?:[A-Za-z]:\\|\/|\.\/|~\/)[^\s"'<>]+/g;
const HOME_USER_REGEX = /C:\\Users\\[^\\\s"'<>]+/gi;
const POSIX_HOME_REGEX = /\/home\/[^\s/"'<>]+/g;

/**
 * Known secret-like patterns to strip. This list is deliberately conservative;
 * it catches common accidents (GitHub tokens, AWS access keys, JWTs) but does
 * not attempt to detect everything.
 */
const SECRET_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /ghp_[A-Za-z0-9]{36}/g, replacement: "<redacted-github-token>" },
  { pattern: /github_pat_[A-Za-z0-9_]{82}/g, replacement: "<redacted-github-token>" },
  { pattern: /AKIA[0-9A-Z]{16}/g, replacement: "<redacted-aws-key>" },
  { pattern: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, replacement: "<redacted-jwt>" },
  { pattern: /sk-[A-Za-z0-9]{40,}/g, replacement: "<redacted-api-key>" },
];

function extractMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message || err.name;
  }
  if (typeof err === "string") return err;
  if (err === null || err === undefined) return String(err);
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function redact(message: string): string {
  let out = message;
  out = out.replace(HOME_USER_REGEX, "C:\\Users\\<user>");
  out = out.replace(POSIX_HOME_REGEX, "/home/<user>");
  out = out.replace(PATH_REGEX, "<path>");
  for (const { pattern, replacement } of SECRET_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

/**
 * Format an error for display to the end user. Strips file paths and known
 * secret patterns. Safe to pipe directly into a webview message.
 */
export function formatForUser(err: unknown): string {
  return redact(extractMessage(err));
}

/**
 * Format an error for the developer log. Preserves paths and stack traces so
 * the output channel remains useful for debugging. Never forward this string
 * to the webview.
 */
export function formatForLog(err: unknown): string {
  if (err instanceof Error) {
    return err.stack ?? `${err.name}: ${err.message}`;
  }
  return extractMessage(err);
}
