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
import { compressToolOutput } from "./preToolHook.js";

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
 * Return the first blocked-pattern substring matched by any segment of `command`,
 * or `null` when the command is safe. Used for the dry-run report so the agent
 * knows *which* destructive pattern triggered the match.
 */
export function findBlockedPattern(command: string): string | null {
  const segments = [command, ...shellSegments(command)];
  for (const seg of segments) {
    const normalized = seg.toLowerCase().trim().replace(/\s+/g, " ");
    for (const pattern of BLOCKED_PATTERNS) {
      if (normalized.includes(pattern)) return pattern;
    }
  }
  return null;
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

function readCompressionSetting(): boolean {
  try {
    const config = vscode.workspace.getConfiguration("gemma-code");
    const value = config.get<boolean>("preToolCompression");
    return value !== false;
  } catch {
    return true;
  }
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
    private readonly _timeoutMs: number = DEFAULT_TIMEOUT_MS,
    /**
     * v0.8.0 Phase 5 sub-task 5.7: when true (default), apply the pre-tool
     * command compressor to long stdout produced by `npm test` / `git diff` /
     * `cargo test` / `npm install`. Set false to bypass the compressor (e.g.
     * for byte-identical replays in golden tests).
     */
    private readonly _compressOutput: boolean = readCompressionSetting(),
  ) {}

  private _maybeCompress(input: {
    command: string;
    stdout: string;
    stderr: string;
    exitCode: number;
  }): { stdout: string; stderr: string; compressionRatio: number } {
    if (!this._compressOutput) {
      return { stdout: input.stdout, stderr: input.stderr, compressionRatio: 0 };
    }
    const compressed = compressToolOutput(input);
    return {
      stdout: compressed.stdout,
      stderr: compressed.stderr,
      compressionRatio: compressed.compressionRatio,
    };
  }

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

    const dryRun = p.dry_run === true;

    // Resolve cwd before any safety check that depends on it; cwd path-guard is a
    // hard error in both dry-run and live paths because the tool would otherwise
    // have no defensible working directory to report.
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

    if (dryRun) {
      return this._dryRunReport(id, p.command, cwd);
    }

    // Hard safety: unconditionally block dangerous command patterns on the live
    // execution path. Confirmation is handled centrally by ToolRegistry via
    // PermissionTiers. (Dry-run reports the match instead of blocking so the
    // agent can inspect what would have triggered.)
    if (isBlocked(p.command)) {
      return failResult(
        id,
        `Command "${p.command}" is blocked for safety (matches a destructive pattern). ` +
          `Usage: run_terminal(command=<a non-destructive command>) - avoid rm -rf, dd, mkfs, fork bombs, etc.`,
      );
    }

    return this._runCommand(id, p.command, cwd);
  }

  /**
   * Build the dry-run report for `run_terminal`. The output is plain text framed
   * by `=== DRY RUN: no execution occurred ===` so the agent has a stable contract
   * to recognise dry-run results. Tokens are whitespace-split for readability.
   * Crucially, no subprocess is spawned and no stdout/stderr is simulated.
   */
  private _dryRunReport(id: string, command: string, cwd: string): ToolResult {
    const tokens = command.trim().split(/\s+/).filter(Boolean);
    const allowlisted = isAllowlisted(command);
    const blockedPattern = findBlockedPattern(command);
    const blockedField =
      blockedPattern === null ? "no" : `yes:${blockedPattern}`;
    const tokenList = tokens.map((t) => `'${t}'`).join(", ");
    const output =
      "=== DRY RUN: no execution occurred ===\n" +
      `Tokens: [${tokenList}]\n` +
      `CWD: ${cwd}\n` +
      `Allowlisted: ${allowlisted}\n` +
      `Blocked-pattern match: ${blockedField}`;
    return { id, success: true, output };
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
        const compressed = this._maybeCompress({ command, stdout, stderr, exitCode });
        resolve({
          id,
          success: exitCode === 0,
          output: JSON.stringify({
            stdout: compressed.stdout,
            stderr: compressed.stderr,
            exitCode,
            ...(compressed.compressionRatio > 0
              ? { compressionRatio: compressed.compressionRatio }
              : {}),
          }),
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
