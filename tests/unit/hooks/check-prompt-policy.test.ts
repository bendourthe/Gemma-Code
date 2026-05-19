/**
 * Unit tests for `scripts/hooks/check-prompt-policy.mjs`.
 *
 * Every shipped pattern gets a positive case (the hook must block it) and we
 * verify a sensible negative-case for normal prose. We also exercise the
 * workspace-local override mechanism for additional patterns and the
 * allowlist suppression. ReDoS resistance is asserted indirectly: every
 * built-in pattern must complete on a 64 KB benign prompt within the
 * benchmark budget (see `tests/benchmarks/hooks.bench.ts`).
 */

import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const HOOK_PATH = path.resolve(
  __dirname,
  "../../../scripts/hooks/check-prompt-policy.mjs",
);

interface RunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

function runHook(prompt: string, env: NodeJS.ProcessEnv = {}): Promise<RunResult> {
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
    child.stdin.write(JSON.stringify({ prompt }));
    child.stdin.end();
  });
}

describe("check-prompt-policy hook", () => {
  it("allows benign prose", async () => {
    const result = await runHook(
      "Please refactor the helper function to use async/await.",
    );
    expect(result.exitCode).toBe(0);
  });

  describe("built-in patterns", () => {
    const cases: { name: string; secret: string }[] = [
      // Hook scope is developer secrets a user might paste by accident
      // into a chat with the local model. Cloud-LLM-vendor keys and chat-
      // platform webhooks are deliberately not built-in patterns; teams
      // that need them add their own via the workspace-local override.
      { name: "AWS access key", secret: "AKIAIOSFODNN7EXAMPLE" },
      {
        name: "GitHub PAT",
        secret: "ghp_1234567890abcdef1234567890abcdef1234",
      },
      {
        name: "JWT",
        secret:
          "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
      },
      { name: "SSH header", secret: "-----BEGIN OPENSSH PRIVATE KEY-----" },
      { name: "PEM header", secret: "-----BEGIN PRIVATE KEY-----" },
    ];

    for (const c of cases) {
      it(`blocks a ${c.name}`, async () => {
        const result = await runHook(`Hi here is the secret ${c.secret} please use it`);
        expect(result.exitCode).toBe(2);
        expect(result.stderr).toMatch(/^BLOCKED:/);
      });
    }
  });

  describe("workspace-local override", () => {
    it("supports additive extra patterns", async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gemma-prompt-policy-"));
      try {
        fs.mkdirSync(path.join(tmp, ".nexus"), { recursive: true });
        fs.writeFileSync(
          path.join(tmp, ".nexus", "prompt-policy.json"),
          JSON.stringify({
            extraPatterns: [{ name: "internal-token", regex: "INT-[A-Z0-9]{12}" }],
          }),
          "utf-8",
        );
        const result = await runHook("Token: INT-ABCDEFGHIJKL", {
          GEMMA_HOOK_WORKSPACE_ROOT: tmp,
        });
        expect(result.exitCode).toBe(2);
        expect(result.stderr).toMatch(/internal-token/);
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    });

    it("rejects override patterns with nested quantifiers", async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gemma-prompt-policy-"));
      try {
        fs.mkdirSync(path.join(tmp, ".nexus"), { recursive: true });
        fs.writeFileSync(
          path.join(tmp, ".nexus", "prompt-policy.json"),
          JSON.stringify({
            extraPatterns: [{ name: "evil", regex: "(a+)+" }],
          }),
          "utf-8",
        );
        // The pattern is rejected, so the prompt is allowed (no other match).
        const result = await runHook("aaaaaaaaaaaaaaaaaaa", {
          GEMMA_HOOK_WORKSPACE_ROOT: tmp,
        });
        expect(result.exitCode).toBe(0);
        expect(result.stderr).toMatch(/nested quantifier risk/);
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    });

    it("respects the allowlist for known false positives", async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gemma-prompt-policy-"));
      try {
        fs.mkdirSync(path.join(tmp, ".nexus"), { recursive: true });
        fs.writeFileSync(
          path.join(tmp, ".nexus", "prompt-policy.json"),
          JSON.stringify({ allowlist: ["AKIAIOSFODNN7EXAMPLE"] }),
          "utf-8",
        );
        const result = await runHook("Use AKIAIOSFODNN7EXAMPLE in tests.", {
          GEMMA_HOOK_WORKSPACE_ROOT: tmp,
        });
        expect(result.exitCode).toBe(0);
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    });
  });
});
