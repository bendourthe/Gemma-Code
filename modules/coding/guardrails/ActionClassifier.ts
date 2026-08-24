import type { ToolCall } from "../../../src/tools/types.js";
import { isBlocked } from "../../../src/tools/commandBlocklist.js";
import {
  describeSandbox,
  sandboxRequiresEnhancedConfirmation,
} from "../sandbox/index.js";

export enum ActionRisk {
  REVERSIBLE = "reversible",
  DESTRUCTIVE = "destructive",
  BLOCKED = "blocked",
}

export interface ActionClassification {
  readonly risk: ActionRisk;
  readonly reason: string;
  readonly requiresCheckpoint: boolean;
  readonly enhancedConfirmation: boolean;
}

/**
 * v1.18.0 Phase 6: when the OS sandbox was requested but is unconfined or
 * only partial, the classifier raises enhanced confirmation.
 * `# DEVIATION:` BLOCKED is not boosted; the boost applies only when
 * `execSandboxEnabled` is true and the live mode is not confined.
 */
export interface ClassifyActionOptions {
  readonly execSandboxEnabled?: boolean;
}

/** Read-only shell commands that have no side effects. */
const READ_ONLY_COMMANDS = new Set([
  "ls", "dir", "cat", "head", "tail", "less", "more",
  "git status", "git log", "git diff", "git branch", "git show",
  "echo", "pwd", "which", "type", "where",
  "find", "grep", "rg", "ag", "fd",
  "node --version", "node -v", "npm list", "npm ls", "npm --version",
  "python --version", "python -V",
  "env", "printenv", "whoami", "hostname", "uname",
  "wc", "sort", "uniq", "diff", "file",
]);

/** Shell commands that are destructive and require enhanced confirmation. */
const DESTRUCTIVE_COMMAND_PATTERNS = [
  "git push", "git reset", "git rebase", "git force",
  "rm ", "rm\t", "del ", "del\t", "rmdir", "rd ",
  "DROP ", "TRUNCATE ", "DELETE FROM",
  "npm publish", "docker push",
  "chmod", "chown",
];

/** Read-only tools with no side effects. */
const SAFE_TOOLS = new Set<string>([
  "read_file", "list_directory", "grep_codebase",
  "web_search", "fetch_page",
  "tail_output", "grep_output",
  "watch_path", "hash_file",
]);

/**
 * Classify a tool call by its risk level for safety enforcement.
 *
 * - REVERSIBLE: no side effects or easily undone (reads, searches)
 * - DESTRUCTIVE: modifies state, may need a git checkpoint
 * - BLOCKED: unconditionally prevented (dangerous shell patterns)
 */
export function classifyAction(
  call: ToolCall,
  options: ClassifyActionOptions = {},
): ActionClassification {
  if (SAFE_TOOLS.has(call.tool)) {
    return {
      risk: ActionRisk.REVERSIBLE,
      reason: "Read-only operation",
      requiresCheckpoint: false,
      enhancedConfirmation: false,
    };
  }

  if (call.tool === "delete_file") {
    return {
      risk: ActionRisk.DESTRUCTIVE,
      reason: "File deletion is irreversible without a checkpoint",
      requiresCheckpoint: true,
      enhancedConfirmation: true,
    };
  }

  if (call.tool === "write_file" || call.tool === "edit_file" || call.tool === "create_file") {
    return {
      risk: ActionRisk.DESTRUCTIVE,
      reason: `File modification via ${call.tool}`,
      requiresCheckpoint: false,
      enhancedConfirmation: false,
    };
  }

  if (call.tool.startsWith("browser_")) {
    return {
      risk: ActionRisk.DESTRUCTIVE,
      reason: "Browser automation mutates an isolated profile and ingests untrusted page content",
      requiresCheckpoint: false,
      enhancedConfirmation: true,
    };
  }

  if (call.tool === "run_terminal") {
    return _classifyShellCommand(call, options);
  }

  // MCP tools and unknowns default to DESTRUCTIVE.
  if ((call.tool as string).startsWith("mcp:")) {
    return {
      risk: ActionRisk.DESTRUCTIVE,
      reason: "MCP tools are classified as destructive by default",
      requiresCheckpoint: false,
      enhancedConfirmation: false,
    };
  }

  return {
    risk: ActionRisk.DESTRUCTIVE,
    reason: `Unknown tool "${call.tool}" defaults to destructive`,
    requiresCheckpoint: false,
    enhancedConfirmation: false,
  };
}

function _classifyShellCommand(
  call: ToolCall,
  options: ClassifyActionOptions,
): ActionClassification {
  const command = String(call.parameters["command"] ?? "");

  // Check the hard blocklist first.
  if (isBlocked(command)) {
    return {
      risk: ActionRisk.BLOCKED,
      reason: `Command matches safety blocklist: "${command}"`,
      requiresCheckpoint: false,
      enhancedConfirmation: false,
    };
  }

  let result: ActionClassification | null = null;

  // Check if the command is read-only.
  const normalized = command.trim().toLowerCase();
  for (const safe of READ_ONLY_COMMANDS) {
    if (normalized === safe || normalized.startsWith(safe + " ") || normalized.startsWith(safe + "\t")) {
      result = {
        risk: ActionRisk.REVERSIBLE,
        reason: `Read-only command: ${safe}`,
        requiresCheckpoint: false,
        enhancedConfirmation: false,
      };
      break;
    }
  }

  if (!result) {
    for (const pattern of DESTRUCTIVE_COMMAND_PATTERNS) {
      if (normalized.includes(pattern.toLowerCase())) {
        result = {
          risk: ActionRisk.DESTRUCTIVE,
          reason: `Command contains destructive pattern: "${pattern.trim()}"`,
          requiresCheckpoint: true,
          enhancedConfirmation: true,
        };
        break;
      }
    }
  }

  if (!result) {
    result = {
      risk: ActionRisk.DESTRUCTIVE,
      reason: "Unrecognized shell command defaults to destructive",
      requiresCheckpoint: false,
      enhancedConfirmation: false,
    };
  }

  return applySandboxBoost(result, options);
}

function applySandboxBoost(
  result: ActionClassification,
  options: ClassifyActionOptions,
): ActionClassification {
  if (options.execSandboxEnabled !== true) return result;
  const report = describeSandbox({ enabled: true });
  if (!sandboxRequiresEnhancedConfirmation(report)) return result;
  return {
    ...result,
    enhancedConfirmation: true,
    reason: `${result.reason}; ${report.summary}`,
  };
}
