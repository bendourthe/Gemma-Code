/**
 * Shared helpers for gemma-check rules: file-classification predicates,
 * line-number resolution from a byte offset, and the `Finding` shape.
 */

/**
 * Path predicate used by rules that should not flag test files. Catches the
 * common conventions: `tests/`, `test/`, `__tests__/`, `*.test.{ts,js,mjs,...}`,
 * `*.spec.{ts,js,mjs,...}`. Path is normalised to forward slashes before the
 * match so Windows and POSIX behave identically.
 */
export function isTestFile(filePath) {
  const normalized = filePath.replace(/\\/g, "/");
  if (/(^|\/)tests?\//i.test(normalized)) return true;
  if (/(^|\/)__tests__\//.test(normalized)) return true;
  if (/\.(test|spec)\.[mc]?[jt]sx?$/i.test(normalized)) return true;
  return false;
}

/**
 * Path predicate for example / fixture / docs files. Used by rules that
 * should not flag intentional credential placeholders inside documentation.
 */
export function isExampleFile(filePath) {
  const normalized = filePath.replace(/\\/g, "/");
  if (/(^|\/)(examples?|fixtures?|samples?)\//i.test(normalized)) return true;
  if (/(^|\/)docs?\//i.test(normalized)) return true;
  if (/\.example$/i.test(normalized)) return true;
  if (/(^|\/)README\.md$/i.test(normalized)) return true;
  if (/(^|\/)CHANGELOG\.md$/i.test(normalized)) return true;
  return false;
}

/**
 * Path predicate for "sensitive" files where token / crypto / secret usage
 * gets extra scrutiny. Returns true when the file path (basename or any
 * directory segment) contains one of the trigger words. A file under an
 * `auth/` or `crypto/` directory is treated as sensitive even if the
 * basename itself does not include the trigger.
 */
export function isSecuritySensitiveFile(filePath) {
  const normalized = filePath.replace(/\\/g, "/");
  return /(auth|token|crypto|secret|password|jwt|session)/i.test(normalized);
}

/**
 * Convert a character offset within `contents` to a 1-indexed line / column
 * pair. Linear scan; sufficient for short reports.
 */
export function offsetToPosition(contents, offset) {
  let line = 1;
  let lastBreak = -1;
  for (let i = 0; i < offset && i < contents.length; i++) {
    if (contents.charCodeAt(i) === 10) {
      line++;
      lastBreak = i;
    }
  }
  const column = offset - lastBreak;
  return { line, column };
}

/**
 * Build a single Finding object. Centralising the shape keeps the JSON
 * output stable across rules.
 */
export function finding({ ruleId, severity, filePath, line, column, message }) {
  return {
    rule: ruleId,
    severity,
    file: filePath,
    line,
    column,
    message,
  };
}

/**
 * Resolve the byte bounds (start, end exclusive) of the line that contains
 * `offset` inside `contents`. The end excludes the newline character itself.
 */
export function lineBounds(contents, offset) {
  let start = offset;
  while (start > 0 && contents.charCodeAt(start - 1) !== 10) start--;
  let end = offset;
  while (end < contents.length && contents.charCodeAt(end) !== 10) end++;
  return { start, end };
}

/**
 * Determine whether a finding at the given byte offset should be suppressed
 * by an allow-marker. Recognised markers, on the same line or the line
 * directly above the match:
 *
 *   gemma-check-allow
 *   gemma-check-allow: <rule-id>[, <rule-id>...]
 *   gemma-check-allow-next-line
 *   gemma-check-allow-next-line: <rule-id>[, ...]
 *
 * A bare marker (no rule list) suppresses any rule on that line; a marker
 * with a rule list suppresses only the listed rule ids.
 */
export function isAllowed(contents, offset, ruleId) {
  const { start, end } = lineBounds(contents, offset);
  if (markerMatches(contents.slice(start, end), "gemma-check-allow", ruleId)) {
    return true;
  }
  if (start === 0) return false;
  let prevEnd = start - 1;
  let prevStart = prevEnd;
  while (prevStart > 0 && contents.charCodeAt(prevStart - 1) !== 10) prevStart--;
  return markerMatches(
    contents.slice(prevStart, prevEnd),
    "gemma-check-allow-next-line",
    ruleId,
  );
}

/**
 * Best-effort detector for "match sits inside a comment". Catches the
 * three common JS/TS comment shapes: single-line `//`, single-line trailing
 * `// ...`, and multi-line `/* ... *\/` continuations (whose body lines
 * conventionally start with ` * `). Block-comment detection is a partial
 * heuristic -- it accepts the rendered-comment shape rather than tracking
 * `/*` -> `*\/` state across the file, which is fine for production rule
 * use (intent here is to suppress legit references inside doc comments
 * such as `... blocks \`.env\` files ...`).
 */
export function isInComment(contents, offset) {
  const { start, end } = lineBounds(contents, offset);
  const line = contents.slice(start, end);
  const trimmed = line.trimStart();
  if (trimmed.startsWith("//")) return true;
  if (trimmed.startsWith("/*")) return true;
  if (trimmed.startsWith("*")) return true;
  const matchColumn = offset - start;
  const before = line.slice(0, matchColumn);
  const lineCommentIdx = before.indexOf("//");
  if (lineCommentIdx !== -1) return true;
  return false;
}

function markerMatches(lineText, marker, ruleId) {
  const idx = lineText.indexOf(marker);
  if (idx === -1) return false;
  const after = lineText.slice(idx + marker.length);
  // Reject `gemma-check-allow-next-line` when looking for `gemma-check-allow`.
  if (marker === "gemma-check-allow" && /^-next-line/.test(after)) return false;
  if (!after.startsWith(":")) return true;
  const list = after.slice(1).split(/[,\s]+/).filter(Boolean);
  return list.includes(ruleId);
}
