import { spawn } from "child_process";
import * as vscode from "vscode";
import type {
  ToolHandler,
  ToolResult,
  ConfirmationMode,
  RunTerminalParams,
} from "../types.js";
import type { ConfirmationGate } from "../ConfirmationGate.js";

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Commands that are unconditionally blocked regardless of confirmation mode.
 * The full command string AND every individual segment (split on shell metacharacters)
 * are each checked, so patterns like `echo ok; rm -rf /` are still caught.
 */
const BLOCKED_PATTERNS = [
  "rm -rf /",
  "rm -rf /*",
  "rm -rf ~",
  "format c:",
  "format d:",
  "shutdown",
  "halt",
  "init 0",
  "del /f /s /q c:\\",
  "del /f /s /q c:/",
  "rd /s /q c:\\",
  "mkfs",
  "dd if=/dev/zero",
  "> /dev/sda",
];

/**
 * Split a shell command string on metacharacters that can chain sub-commands
 * (`;`, `&&`, `||`, `|`, newlines) and return all individual segments.
 */
function shellSegments(command: string): string[] {
  return command.split(/;|&&|\|\||[\n|]/).map((s) => s.trim()).filter(Boolean);
}

function isBlocked(command: string): boolean {
  const segments = [command, ...shellSegments(command)];
  return segments.some((seg) => {
    const normalized = seg.toLowerCase().trim();
    return BLOCKED_PATTERNS.some((pattern) => normalized.includes(pattern));
  });
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
    private readonly _confirmationGate: ConfirmationGate,
    private readonly _mode: ConfirmationMode,
    private readonly _timeoutMs: number = DEFAULT_TIMEOUT_MS
  ) {}

  async execute(parameters: Record<string, unknown>): Promise<ToolResult> {
    const id = (parameters["_callId"] as string | undefined) ?? "";
    const p = parameters as unknown as RunTerminalParams;

    if (!p.command || typeof p.command !== "string") {
      return failResult(id, "Missing required parameter: command");
    }

    if (isBlocked(p.command)) {
      return failResult(id, `Command is blocked for safety: "${p.command}"`);
    }

    // Ask for confirmation before executing (unless mode is "never").
    if (this._mode !== "never") {
      const approved = await this._confirmationGate.request(
        id,
        `Run terminal command: ${p.command}`
      );
      if (!approved) {
        return failResult(id, "Command rejected by user.");
      }
    }

    const cwd = typeof p.cwd === "string" ? p.cwd : workspaceRoot();

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
          resolve(failResult(id, `Command timed out after ${this._timeoutMs / 1000}s.`));
          return;
        }
        const exitCode = code ?? -1;
        resolve({
          id,
          success: exitCode === 0,
          output: JSON.stringify({ stdout, stderr, exitCode }),
          error: exitCode !== 0 ? `Command exited with code ${exitCode}` : undefined,
        });
      });

      child.on("error", (err) => {
        clearTimeout(timer);
        resolve(failResult(id, `Spawn error: ${err.message}`));
      });
    });
  }
}
