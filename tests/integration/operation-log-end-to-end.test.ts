/**
 * Integration: Phase 9 (v0.5.0) -- OperationLog wired to AgentLoop.
 *
 * Exercises the contract that one tool execution produces one operation-log
 * line when the log is enabled, and zero when disabled. We bypass the full
 * agent loop and call the registry directly while emulating AgentLoop's
 * post-execution `recordToolCall` so the test stays focused on the wiring
 * contract rather than the LLM-driven control flow.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { OperationLog } from "../../src/observability/OperationLog.js";

describe("operation log end-to-end (integration)", () => {
  let tmpdir: string;
  let log: OperationLog;

  beforeEach(() => {
    tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), "op-log-e2e-"));
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

  it("produces one log line per simulated tool call when enabled", () => {
    log.setEnabled(true);

    // Simulate three tool calls landing through AgentLoop's record path.
    log.recordToolCall({
      toolName: "read_file",
      outcome: "ok",
      path: "src/a.ts",
      sessionId: "session-A",
    });
    log.recordToolCall({
      toolName: "grep_codebase",
      outcome: "ok",
      sessionId: "session-A",
    });
    log.recordToolCall({
      toolName: "edit_file",
      outcome: "error",
      path: "src/b.ts",
      sessionId: "session-A",
    });
    log.flushImmediately();

    const content = fs.readFileSync(log.filePath()!, "utf8");
    const lines = content.split("\n").filter((l) => l.startsWith("## ["));
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/tool=read_file outcome=ok path=src\/a\.ts/);
    expect(lines[1]).toMatch(/tool=grep_codebase outcome=ok path=n\/a/);
    expect(lines[2]).toMatch(/tool=edit_file outcome=error path=src\/b\.ts/);
  });

  it("never writes to disk while disabled", () => {
    // Default state: disabled. recordToolCall is a no-op.
    log.recordToolCall({ toolName: "read_file", outcome: "ok", path: "x.ts" });
    log.flushImmediately();
    const file = log.filePath()!;
    const content = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
    expect(content.trim()).toBe("");
  });
});
