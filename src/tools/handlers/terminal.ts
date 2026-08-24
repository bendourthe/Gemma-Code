import * as vscode from "vscode";
import type {
  ToolHandler,
  ToolResult,
  RunTerminalParams,
} from "../types.js";
import { resolveInsideWorkspace } from "./pathGuard.js";
import { shellSegments, isBlocked, findBlockedPattern } from "../commandBlocklist.js";
import {
  introspectShellCommand,
  detectShellDialect,
} from "../../../modules/coding/guardrails/shellIntrospection.js";
import { formatForUser } from "../../../modules/coding/utils/errors.js";
import {
  CommandCompressor,
  type CompressedOutput,
} from "../../../core/observability/CommandCompressor.js";
import { scrubEnv } from "../../../core/observability/scrubEnv.js";
import {
  describeSandbox,
  formatSandboxViolationError,
  isExecSandboxEnabled,
  isSandboxViolation,
  spawnSandboxed,
  type SandboxReport,
} from "../../../modules/coding/sandbox/index.js";

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

export { BLOCKED_PATTERNS } from "../../../modules/coding/guardrails/policy.js";

// v1.12.0 EM.P2.A: the pure blocklist policy (`shellSegments` / `isBlocked` /
// `findBlockedPattern`) moved to the vscode-free `../commandBlocklist.js` so
// vscode-free code (the skill-optimizer guardrail + its plain-Node composition
// roots) can use it without importing this vscode-coupled module. Re-exported
// here so every existing consumer of terminal.ts is unchanged.
export { isBlocked, findBlockedPattern };

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

/**
 * v1.18.0 Phase 6 (OI-A1): `nexus.coding.execSandbox` is off by default.
 * `NEXUS_EXEC_SANDBOX` overrides so headless hosts share the switch.
 */
function readExecSandboxSetting(): boolean {
  try {
    const cfg = vscode.workspace.getConfiguration("nexus.coding");
    return isExecSandboxEnabled(cfg.get<boolean>("execSandbox") === true);
  } catch {
    return isExecSandboxEnabled();
  }
}

/** `# DEVIATION:` additive `sandbox` key on the JSON result; inputs unchanged. */
function sandboxJson(report: SandboxReport): Record<string, unknown> {
  return {
    sandbox: {
      mode: report.mode,
      summary: report.summary,
      backendId: report.backendId,
      enforced: report.enforced,
      unenforced: report.unenforced,
    },
  };
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
    /**
     * v1.4.0 Phase 6 (A10): optional worktree root. When set, the command's
     * default working directory (and the base against which an explicit
     * workspace-relative `cwd` is resolved) is this directory instead of the
     * VS Code workspace root. `SubAgentManager` passes the sub-agent's isolated
     * git worktree here so its commands mutate that worktree, not the shared
     * workspace. Null (default) preserves the legacy workspace-rooted behavior.
     */
    private readonly _rootOverride: string | null = null,
    /**
     * v1.18.0 Phase 6 (OI-A1): when true, wrap spawn in the OS sandbox.
     * Default off. Tests inject this so they do not depend on vscode config.
     */
    private readonly _execSandboxEnabled: boolean = readExecSandboxSetting(),
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
      // v1.4.0 Phase 6 (A10): when a worktree root override is set, both the
      // default cwd and the base for an explicit workspace-relative `cwd`
      // re-base onto the worktree so the command stays confined to it.
      const baseRoot = this._rootOverride ?? workspaceRoot();
      cwd =
        typeof p.cwd === "string"
          ? resolveInsideWorkspace(p.cwd, baseRoot)
          : baseRoot;
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
    // v1.7.0 Phase 5 (O-A): surface the structural path enumeration so the
    // confirmation surface can answer "what will this command touch?". Fails
    // closed: an un-parseable command reports the fallback reason instead of a
    // path list, matching the gate's fail-closed behavior.
    const introspection = introspectShellCommand(command, detectShellDialect());
    const touchedField = introspection.parsed
      ? `[${introspection.paths
          .map((p) => `${p.operation}:'${p.raw}'`)
          .join(", ")}]`
      : `(unresolved: ${introspection.unsupportedReason ?? "unparseable"})`;
    const sandbox = describeSandbox({ enabled: this._execSandboxEnabled, cwd });
    const output =
      "=== DRY RUN: no execution occurred ===\n" +
      `Tokens: [${tokenList}]\n` +
      `CWD: ${cwd}\n` +
      `Allowlisted: ${allowlisted}\n` +
      `Blocked-pattern match: ${blockedField}\n` +
      `Touched paths: ${touchedField}\n` +
      `Sandbox: ${sandbox.summary}`;
    return { id, success: true, output };
  }

  private _runCommand(id: string, command: string, cwd: string): Promise<ToolResult> {
    return new Promise<ToolResult>((resolve) => {
      let stdout = "";
      let stderr = "";
      let timedOut = false;

      const { child, report } = spawnSandboxed({
        command,
        cwd,
        env: this._childEnv(),
        enabled: this._execSandboxEnabled,
      });

      child.stdout?.on("data", (data: Buffer) => { stdout += data.toString(); });
      child.stderr?.on("data", (data: Buffer) => { stderr += data.toString(); });

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
        if (
          isSandboxViolation({
            mode: report.mode,
            exitCode,
            stderr,
          })
        ) {
          resolve({
            id,
            success: false,
            output: JSON.stringify({
              stdout,
              stderr,
              exitCode,
              ...sandboxJson(report),
            }),
            error: formatSandboxViolationError(command, stderr, exitCode),
          });
          return;
        }
        const compressed = this._maybeCompress({ command, stdout, stderr, exitCode });
        resolve({
          id,
          success: exitCode === 0,
          output: JSON.stringify({
            stdout: compressed.stdout,
            stderr: compressed.stderr,
            exitCode,
            ...sandboxJson(report),
            ...(compressed.compressionRatio > 0
              ? { compressionRatio: compressed.compressionRatio }
              : {}),
            ...(compressed.strategyApplied !== "passthrough"
              ? { strategyApplied: compressed.strategyApplied }
              : {}),
            // v1.4.0 Phase 8 (gap 2.4.P3.F, CLOSED keep-per-result): the gap
            // proposed moving this footer into the next-turn system prompt and
            // dropping the field. We keep it on the result: the footer is only
            // emitted on compressed results (not every result), and co-locating
            // the "raw output at <teePath>" hint with the result it describes is
            // more actionable than a single cross-turn system-prompt line that
            // can only reference the most-recent tee. Relocating it would add
            // cross-cutting tool->session->prompt state for a P3 token saving.
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
