/**
 * Round-trip integration: invoke each harness hook with the kind of payload
 * a real agent harness would produce, and assert the externally observable
 * contract (exit code + stderr prefix). This is intentionally minimal — the
 * unit tests cover individual rules; this test confirms the contract is
 * stable end-to-end.
 */

import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import * as path from "node:path";

const TOOL_HOOK = path.resolve(
  __dirname,
  "../../../scripts/hooks/check-tool-permission.mjs",
);
const PROMPT_HOOK = path.resolve(
  __dirname,
  "../../../scripts/hooks/check-prompt-policy.mjs",
);

interface RunResult {
  exitCode: number | null;
  stderr: string;
}

function run(hookPath: string, payload: unknown): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [hookPath], {
      stdio: ["pipe", "ignore", "pipe"],
      env: process.env,
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ exitCode: code, stderr }));
    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

describe("harness hooks - end-to-end contract", () => {
  it("PreToolUse Bash + .env -> blocked", async () => {
    const result = await run(TOOL_HOOK, {
      tool_name: "Bash",
      tool_input: { command: "cat ./.env" },
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr.startsWith("BLOCKED:")).toBe(true);
  });

  it("PreToolUse Write inside workspace -> allowed", async () => {
    const result = await run(TOOL_HOOK, {
      tool_name: "Write",
      tool_input: { file_path: "src/foo.ts" },
    });
    expect(result.exitCode).toBe(0);
  });

  it("UserPromptSubmit with a fake AWS key -> blocked", async () => {
    const result = await run(PROMPT_HOOK, {
      prompt: "Here is my key AKIAIOSFODNN7EXAMPLE please save it.",
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr.startsWith("BLOCKED:")).toBe(true);
  });

  it("UserPromptSubmit with normal prose -> allowed", async () => {
    const result = await run(PROMPT_HOOK, {
      prompt: "Refactor the AuthGuard to use a typed dependency injection token.",
    });
    expect(result.exitCode).toBe(0);
  });
});
