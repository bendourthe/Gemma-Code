import { spawn } from "child_process";
import * as vscode from "vscode";
import type {
  ToolHandler,
  ToolResult,
  RunTerminalParams,
} from "../types.js";
import { resolveInsideWorkspace } from "./pathGuard.js";
import { BLOCKED_PATTERNS } from "../../guardrails/policy.js";
import { formatForUser } from "../../../modules/coding/utils/errors.js";
import {
  CommandCompressor,
  type CompressedOutput,
} from "../../../core/observability/CommandCompressor.js";
import { scrubEnv } from "../../../core/observability/scrubEnv.js";

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
    // v1.0.0 Phase 2.1: prefer the canonical `nexus.coding.preToolCompression`
    // key. Fall back to the legacy `gemma-code.preToolCompression` for users
    // mid-migration. Default true.
    const nexusCfg = vscode.workspace.getConfiguration("nexus.coding");
    const nexusValue = nexusCfg.inspect<boolean>("preToolCompression");
    if (
      nexusValue &&
      (nexusValue.workspaceFolderValue !== undefined ||
        nexusValue.workspaceValue !== undefined ||
        nexusValue.globalValue !== undefined)
    ) {
      const explicit =
        nexusValue.workspaceFolderValue ??
        nexusValue.workspaceValue ??
        nexusValue.globalValue;
      return explicit !== false;
    }
    const legacyCfg = vscode.workspace.getConfiguration("gemma-code");
    const legacy = legacyCfg.get<boolean>("preToolCompression");
    return legacy !== false;
  } catch {
    return true;
  }
}

/**
 * v1.4.0 Phase 2 (A5): read the `nexus.coding.terminalEnvScrub` toggle. Default
 * true (scrubbing on). Wrapped in try/catch so the handler still constructs in
 * non-vscode contexts (e.g. unit tests) where the configuration API is absent.
 */
function readEnvScrubSetting(): boolean {
  try {
    const cfg = vscode.workspace.getConfiguration("nexus.coding");
    return cfg.get<boolean>("terminalEnvScrub") !== false;
  } catch {
    return true;
  }
}

/**
 * v1.4.0 Phase 2 (A5): read the `nexus.coding.terminalEnvScrubAllowlist` array
 * of environment-variable names allowed to pass through to child processes.
 */
function readEnvScrubAllowlist(): readonly string[] {
  try {
    const cfg = vscode.workspace.getConfiguration("nexus.coding");
    const list = cfg.get<string[]>("terminalEnvScrubAllowlist");
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
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
     *
     * v1.2.0 Phase 2: compression is now performed by
     * `core/observability/CommandCompressor`; the legacy `preToolHook` is
     * retained as a standalone module but no longer gates this handler.
     */
    private readonly _compressOutput: boolean = readCompressionSetting(),
    /**
     * v1.2.0 Phase 2: dependency-inject a `CommandCompressor` instance to
     * allow tests to redirect the tee path to a temp dir. Left undefined in
     * production; a default instance is constructed on first call.
     */
    private readonly _compressor: CommandCompressor | undefined = undefined,
    /**
     * v1.4.0 Phase 2 (A5): when true (default), scrub secret-bearing
     * environment variables from the env handed to spawned child processes.
     * Reversible via the `nexus.coding.terminalEnvScrub` setting.
     */
    private readonly _envScrubEnabled: boolean = readEnvScrubSetting(),
    /**
     * v1.4.0 Phase 2 (A5): exact env-var names allowed through the scrub.
     * Sourced from `nexus.coding.terminalEnvScrubAllowlist`.
     */
    private readonly _envScrubAllowlist: readonly string[] = readEnvScrubAllowlist(),
  ) {}

  /**
   * v1.4.0 Phase 2 (A5): compute the environment passed to child processes.
   * When scrubbing is enabled, sensitive variables are stripped (subject to the
   * allowlist); otherwise the full parent environment is inherited.
   */
  private _childEnv(): NodeJS.ProcessEnv {
    if (!this._envScrubEnabled) return process.env;
    return scrubEnv(process.env, { allowlist: this._envScrubAllowlist });
  }

  private _maybeCompress(input: {
    command: string;
    stdout: string;
    stderr: string;
    exitCode: number;
  }): {
    stdout: string;
    stderr: string;
    compressionRatio: number;
    teePath: string | null;
    strategyApplied: CompressedOutput["strategyApplied"];
  } {
    if (!this._compressOutput) {
      return {
        stdout: input.stdout,
        stderr: input.stderr,
        compressionRatio: 0,
        teePath: null,
        strategyApplied: "passthrough",
      };
    }
    const compressor = this._compressor ?? new CommandCompressor();
    const compressed = compressor.compress(
      input.command,
      input.stdout,
      input.exitCode,
    );
    const compressionRatio =
      compressed.originalBytes > 0
        ? Math.max(0, compressed.originalBytes - compressed.compressedBytes) /
          compressed.originalBytes
        : 0;
    return {
      stdout: compressed.rendered,
      stderr: input.stderr,
      compressionRatio,
      teePath: compressed.teePath,
      strategyApplied: compressed.strategyApplied,
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

      const child = spawn(command, [], { shell: true, cwd, env: this._childEnv() });

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
            ...(compressed.strategyApplied !== "passthrough"
              ? { strategyApplied: compressed.strategyApplied }
              : {}),
            ...(compressed.teePath
              ? {
                  teePath: compressed.teePath,
                  footer: `[Last command compressed; raw output available at ${compressed.teePath} if needed.]`,
                }
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
