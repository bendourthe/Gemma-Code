import { spawn } from "child_process";
import * as vscode from "vscode";
import type {
  ToolHandler,
  ToolResult,
  RunTerminalParams,
} from "../types.js";
import { resolveInsideWorkspace } from "./pathGuard.js";
import { BLOCKED_PATTERNS } from "../../guardrails/policy.js";
import { formatForUser } from "../../utils/errors.js";

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Allowlist of commands that are routinely safe for development workflows.
 * Map key: the first token of the command (case-sensitive).
 * Map value: regex matching the remainder of the command string (after the first token).
 *
 * Commands outside this allowlist still execute, but flow through the standard
 * DANGEROUS-tier confirmation gate in ToolRegistry. The allowlist exists to make
 * the surface area explicit and to surface a clearer warning to the user when a
 * command falls outside it.
 */
export const ALLOWED_COMMANDS: Record<string, RegExp> = {
  git: /^[\s\S]*$/,
  npm: /^[\s\S]*$/,
  pnpm: /^[\s\S]*$/,
  yarn: /^[\s\S]*$/,
  node: /^[\s\S]*$/,
  python: /^[\s\S]*$/,
  python3: /^[\s\S]*$/,
  pytest: /^[\s\S]*$/,
  cargo: /^[\s\S]*$/,
  go: /^[\s\S]*$/,
  make: /^[\s\S]*$/,
  ls: /^[\s\S]*$/,
  cat: /^[\s\S]*$/,
  echo: /^[\s\S]*$/,
  pwd: /^[\s\S]*$/,
};

export { BLOCKED_PATTERNS } from "../../guardrails/policy.js";

/**
 * Split a shell command string on metacharacters that can chain sub-commands
 * (`;`, `&&`, `||`, `|`, newlines) and return all individual segments.
 */
function shellSegments(command: string): string[] {
  return command.split(/;|&&|\|\||[\n|]/).map((s) => s.trim()).filter(Boolean);
}

export function isBlocked(command: string): boolean {
  const segments = [command, ...shellSegments(command)];
  return segments.some((seg) => {
    // Normalize multiple whitespace into single spaces to catch patterns like `rm  -rf /`.
    const normalized = seg.toLowerCase().trim().replace(/\s+/g, " ");
    return BLOCKED_PATTERNS.some((pattern) => normalized.includes(pattern));
  });
}

/**
 * Returns true if every chained segment of the command starts with an allowlisted
 * command and matches its argument pattern. A command that fails this check still
 * executes (after confirmation), but the caller can surface a clearer warning.
 */
export function isAllowlisted(command: string): boolean {
  const segments = shellSegments(command);
  if (segments.length === 0) return false;
  for (const seg of segments) {
    const firstToken = seg.split(/\s+/)[0] ?? "";
    const argPattern = ALLOWED_COMMANDS[firstToken];
    if (!argPattern) return false;
    const args = seg.slice(firstToken.length).trim();
    if (!argPattern.test(args)) return false;
  }
  return true;
}

function workspaceRoot(): string {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return process.cwd();
  }
  return folders[0]!.uri.fsPath;
}

function failResult(id: string, error: string): ToolResult {
  return { id, success: false, output: "", error };
}

export class RunTerminalTool implements ToolHandler {
  constructor(
    private readonly _timeoutMs: number = DEFAULT_TIMEOUT_MS
  ) {}

  async execute(parameters: Record<string, unknown>): Promise<ToolResult> {
    const id = (parameters["_callId"] as string | undefined) ?? "";
    const p = parameters as unknown as RunTerminalParams;

    if (!p.command || typeof p.command !== "string") {
      return failResult(
        id,
        "Missing required parameter: command. " +
          "Usage: run_terminal(command=<shell command>, cwd=<optional workspace-relative cwd>). " +
          "Example: run_terminal(command='git status').",
      );
    }

    // Hard safety: unconditionally block dangerous command patterns.
    // Confirmation is handled centrally by ToolRegistry via PermissionTiers.
    if (isBlocked(p.command)) {
      return failResult(
        id,
        `Command "${p.command}" is blocked for safety (matches a destructive pattern). ` +
          `Usage: run_terminal(command=<a non-destructive command>) — avoid rm -rf, dd, mkfs, fork bombs, etc.`,
      );
    }

    let cwd: string;
    try {
      cwd =
        typeof p.cwd === "string"
          ? resolveInsideWorkspace(p.cwd)
          : workspaceRoot();
    } catch (err) {
      return failResult(
        id,
        `${formatForUser(err)} Usage: run_terminal(command=<...>, cwd=<workspace-relative dir inside the project root>).`,
      );
    }

    return this._runCommand(id, p.command, cwd);
  }

  private _runCommand(id: string, command: string, cwd: string): Promise<ToolResult> {
    return new Promise<ToolResult>((resolve) => {
      let stdout = "";
      let stderr = "";
      let timedOut = false;

      const child = spawn(command, [], { shell: true, cwd });

      child.stdout.on("data", (data: Buffer) => { stdout += data.toString(); });
      child.stderr.on("data", (data: Buffer) => { stderr += data.toString(); });

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
      }, this._timeoutMs);

      child.on("close", (code) => {
        clearTimeout(timer);
        if (timedOut) {
          resolve(
            failResult(
              id,
              `Command timed out after ${this._timeoutMs / 1000}s. ` +
                `Usage: run_terminal(command=<a faster command>) or split the work into smaller invocations.`,
            ),
          );
          return;
        }
        const exitCode = code ?? -1;
        resolve({
          id,
          success: exitCode === 0,
          output: JSON.stringify({ stdout, stderr, exitCode }),
          error:
            exitCode !== 0
              ? `Command "${command}" exited with code ${exitCode}. ` +
                `Usage: inspect stderr above and re-run run_terminal(command=<corrected command>).`
              : undefined,
        });
      });

      child.on("error", (err) => {
        clearTimeout(timer);
        resolve(
          failResult(
            id,
            `Spawn error for command "${command}": ${err.message}. ` +
              `Usage: run_terminal(command=<a command available on PATH>, cwd=<...>).`,
          ),
        );
      });
    });
  }
}
