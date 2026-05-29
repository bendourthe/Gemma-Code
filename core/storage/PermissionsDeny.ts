/**
 * v1.2.0 Phase 5.3 -- `.nexus/permissions.deny` parser.
 *
 * Provides a simple per-tool denylist alongside `.nexusignore`. Whereas
 * `.nexusignore` filters file paths from memory ingest, the code-graph
 * scanner, the watcher, and the sub-agent file tools, the `permissions
 * .deny` file gates specific tool invocations: e.g. denying a Bash
 * command that matches a wildcard pattern, denying a tool name outright,
 * or denying writes to a path pattern.
 *
 * File format (one rule per line, `#` comments and blank lines skipped):
 *
 *   <ToolName>: <pattern>
 *
 * Examples:
 *
 *   run_terminal: rm -rf /*
 *   run_terminal: git push *
 *   write_file: docs/archive/**
 *   *: dangerous-tool
 *
 * The pattern syntax is the same minimatch-ish surface used elsewhere
 * in the codebase (`*` matches any non-separator; `**` spans separators;
 * literal text matches literally). A leading `*: <pattern>` matches any
 * tool name -- useful for blanket bans.
 *
 * The parser is pure -- no filesystem access. Callers read the file
 * content themselves and feed it in.
 */

export interface DenyRule {
  /** The tool name to deny (or `*` for any tool). */
  readonly toolName: string;
  /** The argument or path pattern to match. */
  readonly pattern: string;
  /** Source-file line number for diagnostics. */
  readonly line: number;
}

export interface DenyList {
  readonly rules: readonly DenyRule[];
}

const EMPTY_DENYLIST: DenyList = Object.freeze({ rules: Object.freeze([]) });

/** Parse a `.nexus/permissions.deny` body. */
export function parsePermissionsDeny(content: string | null | undefined): DenyList {
  if (!content) return EMPTY_DENYLIST;
  const rules: DenyRule[] = [];
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i] ?? "";
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;
    if (trimmed.startsWith("#")) continue;
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) continue;
    const toolName = trimmed.slice(0, colonIdx).trim();
    const pattern = trimmed.slice(colonIdx + 1).trim();
    if (toolName.length === 0 || pattern.length === 0) continue;
    rules.push({ toolName, pattern, line: i + 1 });
  }
  return Object.freeze({ rules: Object.freeze(rules) });
}

/**
 * Result of evaluating a tool invocation against the denylist. When
 * `denied: true`, the caller MUST refuse the call; the matched rule is
 * included so the rejection message can cite it.
 */
export interface DenyEvaluation {
  readonly denied: boolean;
  readonly rule?: DenyRule;
}

/**
 * Evaluate a tool invocation against the denylist. `subject` is the
 * argument the rule pattern is matched against (typically a Bash
 * command string for `run_terminal`, or a file path for `write_file` /
 * `delete_file`). Returns the first matching rule.
 */
export function evaluateDeny(
  toolName: string,
  subject: string,
  list: DenyList,
): DenyEvaluation {
  for (const rule of list.rules) {
    if (rule.toolName !== "*" && rule.toolName !== toolName) continue;
    if (matchDenyGlob(rule.pattern, subject)) {
      return { denied: true, rule };
    }
  }
  return { denied: false };
}

/**
 * Compact glob matcher used by the denylist. Mirrors the shape used in
 * `core/skills/SkillCatalog.matchPathScope` but kept here as a stand-
 * alone implementation so the storage module has no skills dependency.
 *
 * Pattern semantics:
 *   - `**` matches `.*`.
 *   - `*` matches `[^/ ]*` for path-ish patterns; for command patterns
 *     (no `/`), `*` simply matches any sequence of non-whitespace.
 *   - Anything else is regex-escaped.
 */
function matchDenyGlob(pattern: string, subject: string): boolean {
  if (pattern.length === 0) return false;
  // Use a path-aware matcher when the pattern looks path-shaped
  // (contains `/`); otherwise treat `*` as "any chars" so command
  // patterns like `git push *` match arbitrary trailing argv.
  const pathLike = pattern.includes("/");
  let regex = "^";
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i]!;
    if (ch === "*") {
      if (pattern[i + 1] === "*") {
        let j = i + 2;
        while (pattern[j] === "*") j += 1;
        if (pattern[j] === "/") {
          regex += "(?:.*/)?";
          i = j + 1;
          continue;
        }
        regex += ".*";
        i = j;
        continue;
      }
      regex += pathLike ? "[^/]*" : ".*";
      i += 1;
      continue;
    }
    if (ch === "/" || /[A-Za-z0-9_-]/.test(ch)) {
      regex += ch;
      i += 1;
      continue;
    }
    regex += "\\" + ch;
    i += 1;
  }
  regex += "$";
  return new RegExp(regex).test(subject);
}
