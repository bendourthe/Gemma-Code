/**
 * v1.2.0 Phase 5.1 -- Read-only exploration sub-agent enforcement.
 *
 * Implements the agent-loop policy from the 2026-05 ecosystem comparison
 * (S3 item 16) -- sub-agents dispatched with `intent: 'explore'` may only
 * call read-only tools. Any attempt to invoke a write tool (Edit, Write,
 * Bash with a side-effect command) is rejected with a structured error
 * before the tool runs.
 *
 * The policy is intentionally placed under `core/coding/` (not `src/`) so
 * it is callable from both the in-process sub-agent dispatch path (the
 * v1.0.0 `SubAgentManager` in `src/agents/`) and any future re-implementation
 * that lands under `modules/coding/` during the one-cycle compat window.
 *
 * Boundaries (per AGENTS.md "Project Layout"):
 *   - core/coding/ may export to modules/coding/ and to src/ during compat.
 *   - core/coding/ must NOT import from modules/coding/ or src/.
 *   - The policy carries zero runtime dependencies; tests inject the input
 *     surface directly.
 */

/**
 * Sub-agent intent. `explore` is the read-only intent introduced in Phase
 * 5.1. Other intents (`implement`, `verify`, `research`) keep the broader
 * tool surface their specialist definition already grants -- the policy
 * enforces nothing on those.
 */
export type SubAgentIntent = "explore" | "implement" | "verify" | "research";

/** Tool name surface. Mirrors the static names registered in `ToolRegistry`. */
export type ToolName = string;

/**
 * Read-only tool allowlist for `intent: 'explore'`. The list is deliberately
 * explicit -- a new tool added to the codebase does NOT auto-inherit
 * explore access; the policy author must add it here after confirming
 * the tool has no side effects.
 */
export const EXPLORE_READONLY_TOOLS: readonly ToolName[] = [
  // Core read-only filesystem tools (matches the v1.0.0 `TOOLS_BY_TYPE` for
  // verification + research, minus run_terminal which gets a separate
  // command allowlist below).
  "read_file",
  "list_directory",
  "grep_codebase",
  // Phase 3 codegraph tools -- all eight surfaces from the MCP harness
  // are query-only by construction (see core/codegraph/mcp/).
  "codegraph_search",
  "codegraph_context",
  "codegraph_trace",
  "codegraph_callers",
  "codegraph_callees",
  "codegraph_impact",
  "codegraph_node",
  "codegraph_explore",
  "codegraph_files",
  // Web read tools are explorers too -- they fetch but do not mutate.
  "web_search",
  "fetch_page",
];

/**
 * v1.4.0 Phase 8 (gap 5.1.P2.P) -- write-verb tokens used to auto-classify
 * dynamically-discovered MCP tools. Built-in tools are vetted by hand into
 * `EXPLORE_READONLY_TOOLS`, but MCP tools arrive at runtime from arbitrary
 * servers and cannot be pre-listed. A conservative name heuristic keeps an
 * explore sub-agent away from any MCP tool whose name advertises a mutation.
 */
const MCP_WRITE_VERB_TOKENS: ReadonlySet<string> = new Set([
  "write", "create", "delete", "edit", "update", "remove", "set", "put",
  "post", "patch", "append", "insert", "drop", "truncate", "rename", "move",
  "copy", "mkdir", "rmdir", "exec", "execute", "run", "spawn", "kill",
  "send", "publish", "push", "commit", "merge", "apply", "save", "upload",
  "modify", "destroy", "purge", "clear", "reset", "revoke", "grant",
]);

/**
 * v1.4.0 Phase 8 (gap 5.1.P2.P) -- decide whether an MCP tool name looks
 * read-only (so an explore sub-agent may call it). MCP tools are named
 * `mcp:<server>/<tool>`; this returns true only for MCP-qualified names whose
 * tokens contain no write verb. Non-MCP names return false (built-in tools are
 * gated by the explicit `EXPLORE_READONLY_TOOLS` allowlist instead). The check
 * is deliberately conservative: an unrecognised verb stays allowed, but any
 * known mutation verb anywhere in the name disqualifies the tool.
 */
export function isMcpToolName(toolName: string): boolean {
  return toolName.startsWith("mcp:") || toolName.startsWith("mcp__");
}

export function mcpToolLooksReadOnly(toolName: string): boolean {
  if (!isMcpToolName(toolName)) return false;
  const tokens = toolName.toLowerCase().split(/[^a-z0-9]+/u).filter(Boolean);
  return !tokens.some((t) => MCP_WRITE_VERB_TOKENS.has(t));
}

/**
 * Read-only Bash command allowlist for `intent: 'explore'`. Sub-agents may
 * call `run_terminal` only when the command (first argv token) is one of
 * these.
 *
 * The list intentionally excludes anything that writes to the working
 * tree, mutates git state, or hits the network. `grep`, `find`, and
 * `tree` are present for filesystem enumeration; `cat`, `head`, `tail`,
 * `wc` are present for content inspection; `git status` / `log` / `diff`
 * / `show` / `rev-parse` are present for read-only git introspection.
 */
export const EXPLORE_READONLY_BASH_COMMANDS: readonly string[] = [
  "ls",
  "cat",
  "head",
  "tail",
  "wc",
  "find",
  "tree",
  "grep",
  "rg",
  "file",
  "stat",
  "pwd",
  "echo",
  "git",
];

/**
 * Read-only git subcommand allowlist. When `command === 'git'`, the first
 * positional arg must be one of these. The intent is to keep `git status`
 * / `git log` callable while rejecting `git push`, `git commit`, etc.
 */
export const EXPLORE_READONLY_GIT_SUBCOMMANDS: readonly string[] = [
  "status",
  "log",
  "diff",
  "show",
  "rev-parse",
  "ls-files",
  "ls-tree",
  "blame",
  "config",
  "remote",
  "branch",
  "describe",
  "name-rev",
  "for-each-ref",
];

/**
 * Decision returned by `evaluateExploreToolCall`. `allow: true` means the
 * tool call passes the read-only check; `allow: false` carries a stable
 * machine-readable reason code plus a human-readable message that the
 * sub-agent dispatch layer surfaces in the tool result.
 */
export interface PolicyDecision {
  readonly allow: boolean;
  readonly reason?:
    | "tool-not-in-allowlist"
    | "bash-command-not-allowed"
    | "git-subcommand-not-allowed"
    | "no-command";
  readonly message?: string;
}

export interface ToolCallContext {
  readonly intent: SubAgentIntent;
  readonly toolName: ToolName;
  /**
   * When `toolName === 'run_terminal'`, the command string the sub-agent is
   * about to execute. Pass the full shell string; the policy parses out
   * the first token.
   */
  readonly command?: string;
  /**
   * Optional per-policy extra allowlist for run_terminal commands.
   * Defaults to `EXPLORE_READONLY_BASH_COMMANDS`. The dispatch layer reads
   * this from the user's settings so the allowlist can be widened
   * project-by-project without editing source.
   */
  readonly extraReadOnlyBashCommands?: readonly string[];
}

/**
 * Evaluate a sub-agent tool call against the read-only policy.
 *
 * The function is pure -- callers wire it into the dispatch layer once and
 * the tests inject fake `ToolCallContext` records directly.
 */
export function evaluateExploreToolCall(ctx: ToolCallContext): PolicyDecision {
  if (ctx.intent !== "explore") return { allow: true };

  // Non-bash tools: pure allowlist check.
  if (ctx.toolName !== "run_terminal") {
    if (EXPLORE_READONLY_TOOLS.includes(ctx.toolName)) {
      return { allow: true };
    }
    return {
      allow: false,
      reason: "tool-not-in-allowlist",
      message:
        `Sub-agent with intent='explore' may not call '${ctx.toolName}'. ` +
        `Allowed tools: ${EXPLORE_READONLY_TOOLS.join(", ")}, run_terminal (with read-only command).`,
    };
  }

  // run_terminal path -- parse first argv token.
  const command = (ctx.command ?? "").trim();
  if (command.length === 0) {
    return {
      allow: false,
      reason: "no-command",
      message: "Sub-agent with intent='explore' invoked run_terminal with an empty command.",
    };
  }

  const tokens = tokenizeCommandLine(command);
  const head = tokens[0];
  if (!head) {
    return {
      allow: false,
      reason: "no-command",
      message: "Sub-agent with intent='explore' invoked run_terminal with no command name.",
    };
  }

  const allowed = ctx.extraReadOnlyBashCommands ?? EXPLORE_READONLY_BASH_COMMANDS;
  if (!allowed.includes(head)) {
    return {
      allow: false,
      reason: "bash-command-not-allowed",
      message:
        `Sub-agent with intent='explore' may not run '${head}'. ` +
        `Allowed read-only commands: ${allowed.join(", ")}.`,
    };
  }

  // git is the one head command with subcommand-level discrimination.
  if (head === "git") {
    const sub = tokens[1];
    if (!sub || !EXPLORE_READONLY_GIT_SUBCOMMANDS.includes(sub)) {
      return {
        allow: false,
        reason: "git-subcommand-not-allowed",
        message:
          `Sub-agent with intent='explore' may only run read-only git subcommands ` +
          `(${EXPLORE_READONLY_GIT_SUBCOMMANDS.join(", ")}); refused '${sub ?? "(none)"}'.`,
      };
    }
  }

  return { allow: true };
}

/**
 * Specialist / sub-agent definition lint surface. The dispatch layer (and
 * the `nexus-check` linter rule for `.claude/agents/` definitions) calls
 * this on every specialist load to flag definitions that combine
 * `intent: 'explore'` with write tools.
 *
 * Returns an array of human-readable findings (empty when clean). Tests
 * exercise the function directly with synthetic specialist records.
 */
export interface ExploreLintInput {
  readonly intent: SubAgentIntent;
  readonly toolScope: readonly ToolName[];
  /** Optional source path used in error messages (e.g. `.claude/agents/foo.md`). */
  readonly sourcePath?: string;
}

const WRITE_TOOL_NAMES: readonly ToolName[] = [
  "write_file",
  "edit_file",
  "apply_patch",
  "create_file",
  "delete_file",
  "modify_file",
];

export function lintExploreSpecialist(input: ExploreLintInput): readonly string[] {
  if (input.intent !== "explore") return [];
  const findings: string[] = [];
  const where = input.sourcePath ? ` in ${input.sourcePath}` : "";

  for (const tool of input.toolScope) {
    if (WRITE_TOOL_NAMES.includes(tool)) {
      findings.push(
        `Specialist${where} declares intent='explore' but lists write tool '${tool}' ` +
          `in its toolScope. Explore sub-agents must be read-only; remove the tool or ` +
          `change intent.`,
      );
    }
    // run_terminal is allowed but warned about so the author confirms the
    // bash command allowlist is intended.
    if (tool === "run_terminal") {
      findings.push(
        `Specialist${where} declares intent='explore' AND includes 'run_terminal'. ` +
          `Confirm the read-only bash command allowlist applies (see ` +
          `EXPLORE_READONLY_BASH_COMMANDS); the dispatch layer enforces it at call time.`,
      );
    }
  }
  return findings;
}

/**
 * Minimal POSIX-ish command-line tokenizer. Handles single + double quotes
 * and backslash escapes; ignores environment-variable assignments and
 * pipes (the policy operates on the head command only, so anything past a
 * pipe / redirect is out of scope for the allowlist check -- we tokenize
 * up to the first such operator and return what we have).
 *
 * The tokenizer is intentionally compact -- it is not a full shell parser
 * and is not used for anything beyond extracting `argv[0]` and `argv[1]`.
 */
export function tokenizeCommandLine(line: string): readonly string[] {
  const out: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  let i = 0;
  const flush = () => {
    if (current.length > 0) out.push(current);
    current = "";
  };
  while (i < line.length) {
    const ch = line[i]!;
    if (ch === "\\" && i + 1 < line.length && !inSingle) {
      current += line[i + 1]!;
      i += 2;
      continue;
    }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      i += 1;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      i += 1;
      continue;
    }
    if (!inSingle && !inDouble) {
      if (ch === " " || ch === "\t") {
        flush();
        i += 1;
        continue;
      }
      // Stop tokenizing at the first pipe / redirect / semicolon so the
      // head command is unambiguous. Anything past these is irrelevant
      // to the allowlist check.
      if (ch === "|" || ch === ";" || ch === ">" || ch === "<" || ch === "&") {
        flush();
        return out;
      }
    }
    current += ch;
    i += 1;
  }
  flush();
  return out;
}
