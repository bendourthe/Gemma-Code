import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { OperationLog } from "../../../src/observability/OperationLog.js";

/**
 * Phase 9 (v0.5.0) -- OperationLog unit tests.
 *
 * The log is opt-in: when disabled `recordToolCall` is a no-op. When
 * enabled, each call appends one Markdown-friendly line that contains only
 * tool metadata. Paths matching the secret-path denylist redact to
 * `<redacted>` so a leaked enabled-flag cannot exfiltrate secrets.
 */
describe("OperationLog", () => {
  let tmpdir: string;
  let log: OperationLog;

  beforeEach(() => {
    tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), "operation-log-test-"));
    log = new OperationLog();
    log.open(tmpdir);
  });

  afterEach(() => {
    log.close();
    try {
      fs.rmSync(tmpdir, { recursive: true, force: true });
    } catch {
      /* swallow */
    }
  });

  it("does not write when disabled", () => {
    log.recordToolCall({
      toolName: "read_file",
      outcome: "ok",
      path: "src/index.ts",
      sessionId: "s1",
    });
    log.flushImmediately();

    const file = log.filePath()!;
    const content = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
    expect(content.trim()).toBe("");
  });

  it("writes one grep-friendly line per call when enabled", () => {
    log.setEnabled(true);
    log.recordToolCall({
      toolName: "read_file",
      outcome: "ok",
      path: "src/index.ts",
      sessionId: "s1",
      timestamp: new Date("2026-04-25T12:00:00Z").getTime(),
    });
    log.flushImmediately();

    const content = fs.readFileSync(log.filePath()!, "utf8");
    expect(content).toMatch(
      /^## \[2026-04-25T12:00:00\.000Z\] tool=read_file outcome=ok path=src\/index\.ts session=s1$/m,
    );
    // Grep-friendly: every line starts with the canonical prefix.
    const lines = content.split("\n").filter((l) => l.length > 0);
    expect(lines.every((l) => l.startsWith("## ["))).toBe(true);
  });

  it("redacts paths matching the secret-path denylist", () => {
    log.setEnabled(true);
    log.recordToolCall({
      toolName: "read_file",
      outcome: "ok",
      path: ".env",
      sessionId: "s1",
    });
    log.flushImmediately();
    const content = fs.readFileSync(log.filePath()!, "utf8");
    expect(content).toMatch(/path=<redacted>/);
    expect(content).not.toMatch(/\.env/);
  });

  it("records 'n/a' when no path is supplied", () => {
    log.setEnabled(true);
    log.recordToolCall({
      toolName: "run_terminal",
      outcome: "ok",
      sessionId: "s1",
    });
    log.flushImmediately();
    const content = fs.readFileSync(log.filePath()!, "utf8");
    expect(content).toMatch(/path=n\/a/);
  });

  it("records outcome=error for failures", () => {
    log.setEnabled(true);
    log.recordToolCall({
      toolName: "edit_file",
      outcome: "error",
      path: "src/x.ts",
      sessionId: "s1",
    });
    log.flushImmediately();
    const content = fs.readFileSync(log.filePath()!, "utf8");
    expect(content).toMatch(/outcome=error/);
  });

  it("close() flushes the buffer synchronously", () => {
    log.setEnabled(true);
    for (let i = 0; i < 5; i++) {
      log.recordToolCall({
        toolName: "read_file",
        outcome: "ok",
        path: `src/f${i}.ts`,
        sessionId: "s1",
      });
    }
    log.close();

    const file = path.join(tmpdir, ".gemma-code", "operation-log.md");
    const content = fs.readFileSync(file, "utf8");
    const lines = content.split("\n").filter((l) => l.startsWith("## ["));
    expect(lines).toHaveLength(5);
  });

  it("setEnabled(false) stops subsequent writes but flushes pending ones", () => {
    log.setEnabled(true);
    log.recordToolCall({ toolName: "read_file", outcome: "ok", path: "a.ts" });
    log.setEnabled(false);
    log.recordToolCall({ toolName: "read_file", outcome: "ok", path: "b.ts" });
    log.flushImmediately();

    const content = fs.readFileSync(log.filePath()!, "utf8");
    expect(content).toMatch(/path=a\.ts/);
    expect(content).not.toMatch(/path=b\.ts/);
  });

  it("status() returns the last 5 lines", () => {
    log.setEnabled(true);
    for (let i = 0; i < 10; i++) {
      log.recordToolCall({
        toolName: "read_file",
        outcome: "ok",
        path: `src/f${i}.ts`,
        sessionId: "s1",
      });
    }
    const status = log.status();
    expect(status.enabled).toBe(true);
    expect(status.filePath).not.toBeNull();
    expect(status.fileSizeBytes).toBeGreaterThan(0);
    expect(status.lastLines).toHaveLength(5);
    expect(status.lastLines[4]).toMatch(/path=src\/f9\.ts/);
  });

  it("clear() truncates the log file", () => {
    log.setEnabled(true);
    log.recordToolCall({ toolName: "read_file", outcome: "ok", path: "a.ts" });
    log.flushImmediately();
    expect(fs.statSync(log.filePath()!).size).toBeGreaterThan(0);
    log.clear();
    expect(fs.statSync(log.filePath()!).size).toBe(0);
  });
});
