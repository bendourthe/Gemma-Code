/**
 * v1.7.0 Phase 5 (comparison item O-A) -- shell-command introspection for
 * permission gating.
 *
 * Reverse-engineers opencode's `tool/shell/` command-introspection idea as a
 * lean, dependency-free local module (per the AGENTS.md MCP Registry Policy:
 * reverse-engineer-first, no new heavy dependency, zero outbound). It turns
 * "what will this shell command touch?" from a regex guess into a structural
 * enumeration of the files / paths / cwd a proposed command operates on, so the
 * terminal permission gate can match those paths against the existing
 * `.nexus/permissions.deny` denylist + tier model instead of only matching the
 * whole command string.
 *
 * FAIL CLOSED: the introspector only ever *tightens* the surface. When a command
 * uses a construct it cannot statically resolve -- command / process
 * substitution, variable expansion into a path, an unbalanced quote -- it returns
 * `{ parsed: false }` so the caller falls back to the existing denylist / tier
 * gate and NEVER auto-allows. Enumeration is additive: it can only add a refusal,
 * never downgrade a tier or approve a command.
 *
 * Scope note: the bundled `tree-sitter-wasms` package ships only a bash grammar
 * (no PowerShell / cmd), and pulling additional native grammars conflicts with
 * the no-runtime-download / reverse-engineer-first principle, so all three
 * dialects are parsed by this structural tokenizer. An AST-backed bash upgrade
 * over the already-bundled `tree-sitter-bash.wasm` is a recorded forward-tier
 * follow-up; the structural enumeration below is the always-available, fail-closed
 * core the gate depends on.
 */

/** The shell dialect a command will run under. */
export type ShellDialect = "bash" | "powershell" | "cmd";

/** The filesystem operation an enumerated path is subject to. */
export type PathOperation = "read" | "write" | "delete" | "cwd";

/** One path a command was found to touch, with the operation applied to it. */
export interface TouchedPath {
  /** The path token exactly as it appeared in the command (quotes stripped). */
  readonly raw: string;
  /** The operation the command applies to this path. */
  readonly operation: PathOperation;
}

/** The structural introspection of a single shell command string. */
export interface CommandIntrospection {
  /**
   * True when the command was fully parsed into a set of touched paths. False
   * (fail-closed) when the command contains a construct that could hide a path
   * from static analysis; the caller must then fall back to the existing gate.
   */
  readonly parsed: boolean;
  /** The paths the command touches (empty when `parsed` is false). */
  readonly paths: readonly TouchedPath[];
  /** The individual chained sub-commands the command was split into. */
  readonly segments: readonly string[];
  /** When `parsed` is false, a short human-readable reason for the fallback. */
  readonly unsupportedReason?: string;
}

/**
 * Pick the dialect a command will actually execute under. `run_terminal` spawns
 * with `{ shell: true }`, so on Windows the shell is `cmd.exe` (via ComSpec) and
 * on every other platform it is a POSIX `/bin/sh` (bash-compatible).
 */
export function detectShellDialect(
  platform: NodeJS.Platform = process.platform,
): ShellDialect {
  return platform === "win32" ? "cmd" : "bash";
}

// Per-dialect markers that make static path enumeration unsound: if any appears,
// a path could be constructed at runtime that we cannot see, so we fail closed.
const DYNAMIC_MARKERS: Record<ShellDialect, readonly string[]> = {
  // bash: command substitution, process substitution, variable/arithmetic
  // expansion, backtick, explicit eval.
  bash: ["$(", "${", "$((", "<(", ">(", "`", "$", "eval "],
  // PowerShell: subexpression `$(`, array/splat `@(`, call `&(`, any `$var`,
  // backtick (escape/continuation), and Invoke-Expression.
  powershell: ["$(", "@(", "&(", "`", "$", "iex ", "invoke-expression"],
  // cmd: `%VAR%` / delayed `!VAR!` expansion, `for` loops, `call`.
  cmd: ["%", "!", "for ", "call "],
};

// Characters that chain sub-commands. Splitting on them and analyzing each
// segment independently handles `a && b`, `a | b`, `a; b`, and newlines.
const SEGMENT_SPLIT = /;|&&|\|\||[\n|]/;

interface CommandSpec {
  /** Operation applied to every path arg except the last. */
  readonly others: PathOperation | null;
  /** Operation applied to the last path arg. */
  readonly last: PathOperation | null;
}

// File-touching command heads per dialect. A command absent from the table
// contributes no argument paths (only its redirection targets), so `git`,
// `npm`, and friends never mark their non-path arguments as touched paths.
const COMMAND_SPECS: Record<ShellDialect, Readonly<Record<string, CommandSpec>>> = {
  bash: {
    rm: { others: "delete", last: "delete" },
    unlink: { others: "delete", last: "delete" },
    rmdir: { others: "delete", last: "delete" },
    cp: { others: "read", last: "write" },
    mv: { others: "read", last: "write" },
    install: { others: "read", last: "write" },
    touch: { others: "write", last: "write" },
    mkdir: { others: "write", last: "write" },
    tee: { others: "write", last: "write" },
    dd: { others: "write", last: "write" },
    cat: { others: "read", last: "read" },
    head: { others: "read", last: "read" },
    tail: { others: "read", last: "read" },
    less: { others: "read", last: "read" },
    more: { others: "read", last: "read" },
    wc: { others: "read", last: "read" },
    cd: { others: "cwd", last: "cwd" },
    chdir: { others: "cwd", last: "cwd" },
    pushd: { others: "cwd", last: "cwd" },
  },
  cmd: {
    del: { others: "delete", last: "delete" },
    erase: { others: "delete", last: "delete" },
    rd: { others: "delete", last: "delete" },
    rmdir: { others: "delete", last: "delete" },
    copy: { others: "read", last: "write" },
    xcopy: { others: "read", last: "write" },
    move: { others: "read", last: "write" },
    ren: { others: "read", last: "write" },
    rename: { others: "read", last: "write" },
    md: { others: "write", last: "write" },
    mkdir: { others: "write", last: "write" },
    type: { others: "read", last: "read" },
    cd: { others: "cwd", last: "cwd" },
    chdir: { others: "cwd", last: "cwd" },
    pushd: { others: "cwd", last: "cwd" },
  },
  powershell: {
    "remove-item": { others: "delete", last: "delete" },
    ri: { others: "delete", last: "delete" },
    rm: { others: "delete", last: "delete" },
    del: { others: "delete", last: "delete" },
    rmdir: { others: "delete", last: "delete" },
    "set-content": { others: "write", last: "write" },
    sc: { others: "write", last: "write" },
    "out-file": { others: "write", last: "write" },
    "add-content": { others: "write", last: "write" },
    ac: { others: "write", last: "write" },
    "new-item": { others: "write", last: "write" },
    ni: { others: "write", last: "write" },
    "copy-item": { others: "read", last: "write" },
    cpi: { others: "read", last: "write" },
    copy: { others: "read", last: "write" },
    cp: { others: "read", last: "write" },
    "move-item": { others: "read", last: "write" },
    mi: { others: "read", last: "write" },
    move: { others: "read", last: "write" },
    mv: { others: "read", last: "write" },
    "get-content": { others: "read", last: "read" },
    gc: { others: "read", last: "read" },
    cat: { others: "read", last: "read" },
    type: { others: "read", last: "read" },
    "set-location": { others: "cwd", last: "cwd" },
    sl: { others: "cwd", last: "cwd" },
    cd: { others: "cwd", last: "cwd" },
    chdir: { others: "cwd", last: "cwd" },
    pushd: { others: "cwd", last: "cwd" },
  },
};

// PowerShell named parameters whose value is a path. The operation is inherited
// from the cmdlet spec.
const PS_PATH_PARAMS = new Set([
  "-path",
  "-filepath",
  "-literalpath",
  "-destination",
]);

/**
 * Introspect a shell command, enumerating the paths it will touch. Pure and
 * synchronous. Fails closed (`parsed: false`) on any construct that could hide a
 * path from static analysis.
 */
export function introspectShellCommand(
  command: string,
  dialect: ShellDialect,
): CommandIntrospection {
  const segments = command
    .split(SEGMENT_SPLIT)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const lower = command.toLowerCase();
  for (const marker of DYNAMIC_MARKERS[dialect]) {
    if (lower.includes(marker)) {
      return {
        parsed: false,
        paths: [],
        segments,
        unsupportedReason: `dynamic construct "${marker.trim()}" cannot be statically resolved`,
      };
    }
  }

  const paths: TouchedPath[] = [];
  for (const segment of segments) {
    const tokens = tokenize(segment);
    if (tokens === null) {
      return {
        parsed: false,
        paths: [],
        segments,
        unsupportedReason: "unbalanced quote",
      };
    }
    enumerateSegment(tokens, dialect, paths);
  }

  return { parsed: true, paths, segments };
}

interface Token {
  readonly text: string;
  /** A redirection operator token (`>`, `>>`, `2>`, `&>`, `<`, ...). */
  readonly redirection: boolean;
}

/**
 * Quote-aware tokenizer. Splits on unquoted whitespace, keeps quoted spans
 * intact (quotes stripped), and emits redirection operators as their own tokens.
 * Returns null when a quote is left unterminated (fail-closed signal).
 */
function tokenize(segment: string): Token[] | null {
  const tokens: Token[] = [];
  let current = "";
  let hasCurrent = false;
  let quote: '"' | "'" | null = null;

  const flush = (): void => {
    if (hasCurrent) {
      tokens.push({ text: current, redirection: false });
      current = "";
      hasCurrent = false;
    }
  };

  for (let i = 0; i < segment.length; i += 1) {
    const ch = segment[i]!;

    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
        hasCurrent = true;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      hasCurrent = true; // an empty quoted string is still a token
      continue;
    }

    if (ch === " " || ch === "\t") {
      flush();
      continue;
    }

    // Redirection operators, optionally prefixed by a file-descriptor digit
    // (`2>`, `1>>`). The `&` in an fd-duplication like `2>&1` is deliberately
    // NOT folded into the operator, so its target stays `&1` and is skipped as
    // a non-path below.
    if (ch === ">" || ch === "<") {
      flush();
      let op = ch;
      let j = i + 1;
      if (segment[j] === op) {
        op += op; // >> or <<
        j += 1;
      }
      tokens.push({ text: op, redirection: true });
      i = j - 1;
      continue;
    }

    // A bare fd-prefixed redirection like `2>` or `2>>`.
    if (/[0-9]/.test(ch) && (segment[i + 1] === ">" || segment[i + 1] === "<")) {
      flush();
      let j = i + 1;
      let op = segment[j]!;
      j += 1;
      if (segment[j] === op[0]) {
        op += op;
        j += 1;
      }
      tokens.push({ text: op, redirection: true });
      i = j - 1;
      continue;
    }

    current += ch;
    hasCurrent = true;
  }

  if (quote) return null; // unterminated quote
  flush();
  return tokens;
}

/** Enumerate the touched paths of one already-tokenized segment. */
function enumerateSegment(
  tokens: Token[],
  dialect: ShellDialect,
  out: TouchedPath[],
): void {
  // First pass: redirection targets. The token following a `>`-family operator
  // is a write target; a `<` operator's target is a read. An fd-dup target
  // (`&1`, `&2`) is not a path.
  const consumedByRedirect = new Set<number>();
  for (let i = 0; i < tokens.length; i += 1) {
    const tok = tokens[i]!;
    if (!tok.redirection) continue;
    const target = tokens[i + 1];
    if (!target || target.redirection) continue;
    consumedByRedirect.add(i + 1);
    if (target.text.startsWith("&")) continue; // fd duplication, not a file
    const op: PathOperation = tok.text.includes("<") ? "read" : "write";
    pushPath(out, target.text, op);
  }

  // Second pass: the command head + its argument paths.
  const words = tokens.filter((t) => !t.redirection);
  if (words.length === 0) return;

  const headRaw = words[0]!.text;
  const spec = COMMAND_SPECS[dialect][headRaw.toLowerCase()];
  if (!spec) return; // unknown command: only redirection targets were paths

  // Collect the positional path args (skipping the head, flags, and any tokens
  // already consumed as redirection targets). For PowerShell, a `-Path`-style
  // named parameter's value is also a path.
  const argIndices: number[] = [];
  let idxInTokens = -1;
  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i]!.redirection) continue;
    idxInTokens += 1;
    if (idxInTokens === 0) continue; // the head
    if (consumedByRedirect.has(i)) continue;
    const text = tokens[i]!.text;
    if (dialect === "powershell" && PS_PATH_PARAMS.has(text.toLowerCase())) {
      // The next non-redirection token is the path value.
      const valueIdx = nextWordIndex(tokens, i);
      if (valueIdx !== -1 && !consumedByRedirect.has(valueIdx)) {
        argIndices.push(valueIdx);
        consumedByRedirect.add(valueIdx); // do not double-count positionally
      }
      continue;
    }
    if (isFlag(text, dialect)) continue;
    argIndices.push(i);
  }

  for (let k = 0; k < argIndices.length; k += 1) {
    const isLast = k === argIndices.length - 1;
    const op = isLast ? spec.last : spec.others;
    if (op === null) continue;
    pushPath(out, tokens[argIndices[k]!]!.text, op);
  }
}

/** Index of the next non-redirection token after `from`, or -1. */
function nextWordIndex(tokens: Token[], from: number): number {
  for (let i = from + 1; i < tokens.length; i += 1) {
    if (!tokens[i]!.redirection) return i;
  }
  return -1;
}

/** Whether a token is an option flag (not a path) for the dialect. */
function isFlag(text: string, dialect: ShellDialect): boolean {
  if (text.length === 0) return true;
  if (dialect === "cmd") {
    // cmd switches look like `/f`, `/s`, `/q`, `/y` -- a slash then short alpha.
    // An absolute POSIX path (`/etc/passwd`) contains a later separator and so
    // does not match, and a Windows path uses a drive letter or backslashes.
    return /^\/[a-zA-Z?]+$/.test(text);
  }
  // bash / PowerShell flags start with `-` (`-r`, `--force`, `-Recurse`).
  return text.startsWith("-");
}

/** Normalize a path token and record it. Skips empty tokens. */
function pushPath(out: TouchedPath[], raw: string, operation: PathOperation): void {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return;
  out.push({ raw: trimmed, operation });
}

/**
 * Normalize a path token for denylist matching: back-slashes to forward slashes
 * (the `.nexus/permissions.deny` patterns are `/`-based) and a leading `./`
 * stripped. Used by the gate, not the enumeration, so the reported `raw` stays
 * verbatim for diagnostics.
 */
export function normalizeTouchedPath(raw: string): string {
  let p = raw.replace(/\\/g, "/");
  while (p.startsWith("./")) p = p.slice(2);
  return p;
}
