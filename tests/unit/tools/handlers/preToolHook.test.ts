import { describe, expect, it } from "vitest";
import {
  classifyCommand,
  compressToolOutput,
} from "../../../../src/tools/handlers/preToolHook.js";

describe("preToolHook", () => {
  it("classifies common test commands", () => {
    expect(classifyCommand("npm test")).toBe("test");
    expect(classifyCommand("npx vitest run")).toBe("test");
    expect(classifyCommand("pytest -q")).toBe("test");
    expect(classifyCommand("cargo test --release")).toBe("cargo-test");
    expect(classifyCommand("git diff -- src/")).toBe("git-diff");
    expect(classifyCommand("npm install")).toBe("install");
    expect(classifyCommand("echo hi")).toBeNull();
  });

  it("compresses long vitest output to PASS/FAIL summary + failures", () => {
    const stdout = [
      "RUN  v1.6.1",
      ...Array.from({ length: 500 }, (_, i) => `   PASS test ${i}`),
      "FAIL  src/foo.test.ts > does the thing",
      "Tests: 499 passed, 1 failed",
    ].join("\n");
    const before = stdout;
    const result = compressToolOutput({
      command: "npm test",
      stdout,
      stderr: "",
    });
    expect(result.stdout.length).toBeLessThan(before.length);
    expect(result.stdout).toContain("FAIL");
    expect(result.stdout).toContain("Tests: 499 passed, 1 failed");
    expect(result.compressionRatio).toBeGreaterThan(0.6);
  });

  it("compresses git diff to first 30 lines per file", () => {
    const lines: string[] = [];
    for (let f = 0; f < 2; f++) {
      lines.push(`diff --git a/src/file${f}.ts b/src/file${f}.ts`);
      for (let i = 0; i < 100; i++) {
        lines.push(`+ added line ${i}`);
      }
    }
    const stdout = lines.join("\n");
    const result = compressToolOutput({
      command: "git diff",
      stdout,
      stderr: "",
    });
    expect(result.stdout).toContain("diff --git");
    expect(result.stdout).toContain("more line");
    expect(result.compressionRatio).toBeGreaterThan(0.5);
  });

  it("compresses npm install output to summary lines", () => {
    const stdout = [
      ...Array.from({ length: 100 }, (_, i) => `lots of noise line ${i}`),
      "added 250 packages, audited 300 packages",
      "found 0 vulnerabilities",
    ].join("\n");
    const result = compressToolOutput({
      command: "npm install",
      stdout,
      stderr: "",
    });
    expect(result.stdout).toContain("added 250 packages");
    expect(result.stdout).toContain("found 0 vulnerabilities");
    expect(result.compressionRatio).toBeGreaterThan(0.6);
  });

  it("passes through unknown commands unchanged", () => {
    const stdout = "hello\nworld";
    const result = compressToolOutput({
      command: "echo hi",
      stdout,
      stderr: "",
    });
    expect(result.stdout).toBe(stdout);
    expect(result.compressionRatio).toBe(0);
  });

  it("preserves stderr verbatim", () => {
    const result = compressToolOutput({
      command: "npm test",
      stdout: "PASS lots\n".repeat(500),
      stderr: "important error",
    });
    expect(result.stderr).toBe("important error");
  });
});
