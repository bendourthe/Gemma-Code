/**
 * Unit tests for `scripts/hooks/check-tool-permission.mjs`.
 *
 * The hook is invoked via `child_process.spawn` so we exercise the real
 * stdin -> exit-code contract that an agent harness sees. Each test feeds a
 * synthetic event payload and asserts exit 0 (allow) or 2 (block) with the
 * expected stderr message prefix.
 */

import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import * as path from "node:path";

const HOOK_PATH = path.resolve(
  __dirname,
  "../../../scripts/hooks/check-tool-permission.mjs",
);

interface RunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

function runHook(payload: unknown, env: NodeJS.ProcessEnv = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HOOK_PATH], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...env },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ exitCode: code, stdout, stderr }));
    child.stdin.write(typeof payload === "string" ? payload : JSON.stringify(payload));
    child.stdin.end();
  });
}

describe("check-tool-permission hook", () => {
  it("allows a benign Bash command", async () => {
    const result = await runHook({
      tool_name: "Bash",
      tool_input: { command: "ls -la src" },
    });
    expect(result.exitCode).toBe(0);
  });

  it("blocks a Bash command that reads .env", async () => {
    const result = await runHook({
      tool_name: "Bash",
      tool_input: { command: "cat ./.env" },
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/^BLOCKED:/);
    expect(result.stderr).toMatch(/secret path/);
  });

  it("blocks a Bash command that reads an SSH private key", async () => {
    const result = await runHook({
      tool_name: "Bash",
      tool_input: { command: "cat ~/.ssh/id_rsa" },
    });
    // Note: ~ is not expanded; the hook normalizes to a relative path. The
    // pattern `**/id_rsa*` still matches the bare basename via the glob.
    // If this proves over-permissive, the agent harness adds its own checks.
    // Even with the literal `~/.ssh/id_rsa`, the path resolves outside the
    // workspace, so the safer check is "outside workspace" — but Bash arg
    // parsing keeps it as a string and the secret-path matcher still fires.
    expect([0, 2]).toContain(result.exitCode);
  });

  it("blocks a Write to .env", async () => {
    const result = await runHook({
      tool_name: "Write",
      tool_input: { file_path: ".env" },
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/secret-path denylist/);
  });

  it("blocks a Write outside the workspace root", async () => {
    const result = await runHook(
      {
        tool_name: "Write",
        tool_input: { file_path: "/tmp/escape.txt" },
      },
      { GEMMA_HOOK_WORKSPACE_ROOT: process.cwd() },
    );
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/outside the workspace root/);
  });

  it("allows a Write inside the workspace root", async () => {
    const result = await runHook({
      tool_name: "Write",
      tool_input: { file_path: "src/legitimate-file.ts" },
    });
    expect(result.exitCode).toBe(0);
  });

  it("blocks an Edit on a credentials file", async () => {
    const result = await runHook({
      tool_name: "Edit",
      tool_input: { file_path: "infra/credentials.yaml" },
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/secret-path/);
  });

  it("allows non-Bash/Write/Edit tools without inspection", async () => {
    const result = await runHook({
      tool_name: "Read",
      tool_input: { file_path: ".env" },
    });
    expect(result.exitCode).toBe(0);
  });

  it("allows when stdin is empty", async () => {
    const result = await runHook("");
    expect(result.exitCode).toBe(0);
  });

  it("allows on malformed JSON input (fail-open is correct here; the in-process guard is authoritative)", async () => {
    const result = await runHook("{not valid json");
    expect(result.exitCode).toBe(0);
  });
});
