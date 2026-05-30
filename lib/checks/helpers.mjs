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
 *   nexus-check-allow            (canonical; gemma-check-allow still accepted)
 *   nexus-check-allow: <rule-id>[, <rule-id>...]
 *   nexus-check-allow-next-line
 *   nexus-check-allow-next-line: <rule-id>[, ...]
 *
 * A bare marker (no rule list) suppresses any rule on that line; a marker
 * with a rule list suppresses only the listed rule ids. The legacy
 * `gemma-check-allow*` spelling is honoured alongside the canonical
 * `nexus-check-allow*` so markers written before the v1.0.0 rename keep
 * working (the tool was renamed gemma-check -> nexus-check in Phase 2.4).
 */
export function isAllowed(contents, offset, ruleId) {
  const { start, end } = lineBounds(contents, offset);
  const sameLine = contents.slice(start, end);
  if (
    markerMatches(sameLine, "nexus-check-allow", ruleId) ||
    markerMatches(sameLine, "gemma-check-allow", ruleId)
  ) {
    return true;
  }
  if (start === 0) return false;
  let prevEnd = start - 1;
  let prevStart = prevEnd;
  while (prevStart > 0 && contents.charCodeAt(prevStart - 1) !== 10) prevStart--;
  const prevLine = contents.slice(prevStart, prevEnd);
  return (
    markerMatches(prevLine, "nexus-check-allow-next-line", ruleId) ||
    markerMatches(prevLine, "gemma-check-allow-next-line", ruleId)
  );
}

/**
 * True when the byte at `offset - 1` is a string / template delimiter
 * (backtick, double, or single quote). The test-tampering rules (A2) use
 * this to skip matches that sit inside a string literal -- e.g. a rule's own
 * pattern documented as `it.only(` inside a test name or a regex source --
 * rather than at a real call site. Cheap one-character lookbehind; pairs with
 * `isInComment` to cover the two common "this is documentation, not code"
 * shapes.
 */
export function isQuoted(contents, offset) {
  if (offset <= 0) return false;
  const ch = contents[offset - 1];
  return ch === "`" || ch === '"' || ch === "'";
}

/**
 * Matches a human justification: a TODO/FIXME reference (including the repo's
 * own `TODO(harness-bug)` / `TODO(missing_env)` convention), a "reason:" /
 * "because" phrase, an issue reference (`(#123)` or `GH-123`), or a URL.
 * Bounded quantifiers only -- ReDoS-resistant by construction.
 *
 * Case-sensitive by design: `TODO` / `FIXME` must be upper-case (the comment
 * convention) so the lowercase vitest `.todo(` pending marker is NOT mistaken
 * for its own justification. The reason/because alternates carry an explicit
 * leading-cap class instead of a blanket `i` flag.
 */
const JUSTIFICATION_RE =
  /TODO\s*\(|FIXME\s*\(|[Rr]eason\s*:|[Bb]ecause\b|\(#\d{1,7}\)|\bGH-\d{1,7}\b|https?:\/\//;

/**
 * Best-effort detector for "an otherwise-suspicious construct carries a nearby
 * human justification". Used by the skip-without-reason (A2) and disabled-CI
 * (A2) rules to let a deliberately-skipped test or a deliberately-non-gating
 * CI step pass when the author explained why.
 *
 * The window is the matched line, the two lines above it, and the line below
 * it -- the same +/-2 span the repo's `tests/unit/test-discipline.test.ts`
 * meta-test uses, so this rule never contradicts that established convention.
 * The explicit `nexus-check-allow` marker is handled separately by
 * `isAllowed`; this is the looser prose signal.
 */
export function hasJustification(contents, offset) {
  const { start, end } = lineBounds(contents, offset);
  let windowStart = start;
  for (let n = 0; n < 2 && windowStart > 0; n++) {
    windowStart = lineBounds(contents, windowStart - 1).start;
  }
  let windowEnd = end;
  if (windowEnd < contents.length) {
    windowEnd = lineBounds(contents, windowEnd + 1).end;
  }
  return JUSTIFICATION_RE.test(contents.slice(windowStart, windowEnd));
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
  // Reject the `-next-line` variant when looking for the base marker (either
  // spelling), so a same-line `*-allow-next-line` does not suppress this line.
  if (
    (marker === "gemma-check-allow" || marker === "nexus-check-allow") &&
    /^-next-line/.test(after)
  ) {
    return false;
  }
  if (!after.startsWith(":")) return true;
  const list = after.slice(1).split(/[,\s]+/).filter(Boolean);
  return list.includes(ruleId);
}
