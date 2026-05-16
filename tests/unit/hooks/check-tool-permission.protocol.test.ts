/**
 * v0.8.0 Phase 5 sub-task 5.6 -- new stdin-JSON / stdout-decision protocol
 * coverage for `scripts/hooks/check-tool-permission.mjs`. Re-uses the same
 * spawn harness as the legacy suite but asserts the JSON decision output
 * and the absence of exit code 2 on block.
 */

import { afterEach, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
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
    child.stdout.on("data", (c) => (stdout += c.toString()));
    child.stderr.on("data", (c) => (stderr += c.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ exitCode: code, stdout, stderr }));
    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

describe("check-tool-permission (stdin-JSON decision protocol)", () => {
  let tmpConsent = "";

  afterEach(() => {
    if (tmpConsent && fs.existsSync(tmpConsent)) {
      fs.rmSync(tmpConsent, { force: true });
    }
  });

  it("emits a JSON allow decision with exit 0 for a benign Bash event", async () => {
    const result = await runHook({
      event: "PreToolUse",
      tool: "Bash",
      args: { command: "ls -la src" },
      sessionId: "session-allow",
    });
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout.trim());
    expect(parsed.decision).toBe("allow");
  });

  it("emits a JSON block decision with exit 0 for a secret-path Bash event", async () => {
    const result = await runHook({
      event: "PreToolUse",
      tool: "Bash",
      args: { command: "cat ./.env" },
      sessionId: "session-block",
    });
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout.trim());
    expect(parsed.decision).toBe("block");
    expect(parsed.reason).toMatch(/secret path/i);
  });

  it("records first-seen sessionId in the consent file", async () => {
    tmpConsent = path.join(
      os.tmpdir(),
      `gemma-consent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`,
    );
    await runHook(
      {
        event: "PreToolUse",
        tool: "Bash",
        args: { command: "ls" },
        sessionId: "session-consent",
      },
      { GEMMA_HOOK_CONSENT_FILE: tmpConsent },
    );
    expect(fs.existsSync(tmpConsent)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(tmpConsent, "utf-8"));
    expect(parsed.sessions["session-consent"]).toBeDefined();
  });

  it("falls back to exit-code protocol when no `event` field is present", async () => {
    const result = await runHook({
      tool_name: "Bash",
      tool_input: { command: "cat ./.env" },
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/^BLOCKED:/);
  });
});
