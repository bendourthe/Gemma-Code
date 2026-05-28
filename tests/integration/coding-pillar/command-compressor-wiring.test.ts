/**
 * v1.2.0 Phase 2 sub-task 2.4 -- Integration test for the Coding-pillar
 * Bash-tool wiring of `CommandCompressor`.
 *
 * Drives the `RunTerminalTool` through a synthetic command sequence
 * (`git status`, `pytest`, `grep -r foo .`) with `child_process.spawn`
 * mocked so the assertions are deterministic and offline. Verifies:
 *
 *   1. Compressed bytes total at most 60% of raw bytes total across the
 *      sequence (the Phase 2 sub-task 2.4 stability target).
 *   2. The tool result includes the `teePath` + `strategyApplied` fields
 *      when the compressor fires.
 *   3. Failure-path commands write a tee log under
 *      `<nexus-home>/logs/commands/`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { CommandCompressor } from "../../../core/observability/CommandCompressor.js";

vi.mock("child_process", () => ({
  spawn: vi.fn(),
}));

import { spawn } from "child_process";
import { RunTerminalTool } from "../../../src/tools/handlers/terminal.js";

const mockSpawn = vi.mocked(spawn);

function makeChild(
  stdout: string,
  stderr: string,
  exitCode: number,
  delay = 0,
): ReturnType<typeof spawn> {
  const child = new EventEmitter() as ReturnType<typeof spawn>;
  (child as unknown as { stdout: EventEmitter; stderr: EventEmitter }).stdout =
    new EventEmitter();
  (child as unknown as { stdout: EventEmitter; stderr: EventEmitter }).stderr =
    new EventEmitter();
  (child as unknown as { kill: (signal?: string) => boolean }).kill = vi.fn(
    () => {
      child.emit("close", null);
      return true;
    },
  );
  setTimeout(() => {
    if (stdout) {
      (child as unknown as { stdout: EventEmitter }).stdout.emit(
        "data",
        Buffer.from(stdout),
      );
    }
    if (stderr) {
      (child as unknown as { stderr: EventEmitter }).stderr.emit(
        "data",
        Buffer.from(stderr),
      );
    }
    child.emit("close", exitCode);
  }, delay);
  return child;
}

function params(command: string, callId: string): Record<string, unknown> {
  return { _callId: callId, command };
}

describe("CommandCompressor wiring into RunTerminalTool", () => {
  let tmpHome: string;
  let tool: RunTerminalTool;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "compressor-wiring-"));
    const compressor = new CommandCompressor({ nexusHomeFn: () => tmpHome });
    // Force compression on (third arg true) and inject the temp-home compressor.
    tool = new RunTerminalTool(30_000, true, compressor);
  });

  afterEach(() => {
    vi.useRealTimers();
    try {
      fs.rmSync(tmpHome, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("reduces total bytes by >=40% across a synthetic git/pytest/grep sequence", async () => {
    // Synthetic outputs sized to be obviously compressible.
    const gitStatusRaw = [
      "On branch main",
      "Your branch is up to date with 'origin/main'.",
      "",
      "Changes not staged for commit:",
      "  (use \"git add <file>...\" to update what will be committed)",
      "  (use \"git restore <file>...\" to discard changes)",
      ...Array.from({ length: 50 }, (_, i) => `\tmodified:   src/file${i}.ts`),
      "",
      "no changes added to commit",
    ].join("\n");

    const pytestRaw = [
      ...Array.from({ length: 400 }, () => "PASSED tests/a.test.py::test_one"),
      ...Array.from({ length: 200 }, () => "PASSED tests/b.test.py::test_two"),
      "1 failed, 600 passed in 12.34s",
    ].join("\n");

    const grepRaw = Array.from({ length: 800 }, (_, i) =>
      `src/file${i}.ts:1:hit ${i}`,
    ).join("\n");

    const fixtures = [
      { command: "git status", stdout: gitStatusRaw, exit: 0, id: "c1" },
      { command: "pytest -q", stdout: pytestRaw, exit: 0, id: "c2" },
      { command: "grep -r foo .", stdout: grepRaw, exit: 0, id: "c3" },
    ];

    let rawTotal = 0;
    let compressedTotal = 0;

    for (const f of fixtures) {
      rawTotal += Buffer.byteLength(f.stdout, "utf8");
      mockSpawn.mockReturnValueOnce(makeChild(f.stdout, "", f.exit, 0));
      const result = await tool.execute(params(f.command, f.id));
      expect(result.success).toBe(f.exit === 0);
      const payload = JSON.parse(result.output) as {
        stdout: string;
        strategyApplied?: string;
        teePath?: string;
      };
      compressedTotal += Buffer.byteLength(payload.stdout, "utf8");
      expect(payload.strategyApplied).toBeDefined();
    }

    const ratio = compressedTotal / Math.max(1, rawTotal);
    expect(ratio).toBeLessThan(0.6);
  });

  it("emits teePath + footer on failure-path commands", async () => {
    const pytestRaw = [
      "PASSED tests/a.test.py::test_one",
      "FAILED tests/b.test.py::test_two - AssertionError",
      "1 failed, 1 passed in 0.5s",
    ].join("\n");
    mockSpawn.mockReturnValueOnce(makeChild(pytestRaw, "", 1, 0));

    const result = await tool.execute(params("pytest -q", "fail-1"));
    expect(result.success).toBe(false);

    const payload = JSON.parse(result.output) as {
      teePath?: string;
      footer?: string;
      strategyApplied?: string;
    };
    expect(payload.teePath).toBeTruthy();
    expect(payload.footer).toContain("raw output available at");
    expect(payload.footer).toContain(payload.teePath!);
    expect(fs.existsSync(payload.teePath!)).toBe(true);
    expect(fs.readFileSync(payload.teePath!, "utf8")).toBe(pytestRaw);
    expect(payload.strategyApplied).toBe("dedupe");
  });

  it("omits teePath and footer on a short successful command", async () => {
    mockSpawn.mockReturnValueOnce(makeChild("hello world\n", "", 0, 0));
    const result = await tool.execute(params("echo hi", "ok-1"));
    expect(result.success).toBe(true);
    const payload = JSON.parse(result.output) as {
      teePath?: string;
      footer?: string;
      strategyApplied?: string;
    };
    expect(payload.teePath).toBeUndefined();
    expect(payload.footer).toBeUndefined();
    // `echo` is not in the registry -> passthrough -> field omitted.
    expect(payload.strategyApplied).toBeUndefined();
  });

  it("disabling the compression flag short-circuits the compressor", async () => {
    const compressor = new CommandCompressor({ nexusHomeFn: () => tmpHome });
    const off = new RunTerminalTool(30_000, false, compressor);
    const big = Array.from({ length: 5000 }, (_, i) =>
      `src/file${i}.ts:1:hit ${i}`,
    ).join("\n");
    mockSpawn.mockReturnValueOnce(makeChild(big, "", 0, 0));
    const result = await off.execute(params("grep -r foo .", "off-1"));
    const payload = JSON.parse(result.output) as {
      stdout: string;
      teePath?: string;
      strategyApplied?: string;
    };
    expect(payload.stdout).toBe(big);
    expect(payload.teePath).toBeUndefined();
    expect(payload.strategyApplied).toBeUndefined();
  });
});
