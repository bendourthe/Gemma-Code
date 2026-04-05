import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";
import { RunTerminalTool } from "../../../../src/tools/handlers/terminal.js";
import { ConfirmationGate } from "../../../../src/tools/ConfirmationGate.js";

// ---------------------------------------------------------------------------
// Mock child_process.spawn
// ---------------------------------------------------------------------------

vi.mock("child_process", () => ({
  spawn: vi.fn(),
}));

import { spawn } from "child_process";
const mockSpawn = vi.mocked(spawn);

function makeChild(
  stdout: string,
  stderr: string,
  exitCode: number,
  delay = 0
): ReturnType<typeof spawn> {
  const child = new EventEmitter() as ReturnType<typeof spawn>;
  (child as unknown as { stdout: EventEmitter; stderr: EventEmitter }).stdout = new EventEmitter();
  (child as unknown as { stdout: EventEmitter; stderr: EventEmitter }).stderr = new EventEmitter();
  (child as unknown as { kill: (signal?: string) => boolean }).kill = vi.fn(() => {
    child.emit("close", null);
    return true;
  });

  setTimeout(() => {
    if (stdout) {
      (child as unknown as { stdout: EventEmitter }).stdout.emit("data", Buffer.from(stdout));
    }
    if (stderr) {
      (child as unknown as { stderr: EventEmitter }).stderr.emit("data", Buffer.from(stderr));
    }
    child.emit("close", exitCode);
  }, delay);

  return child;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function params(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { _callId: "call_001", ...overrides };
}

function makeGate(approved = true): ConfirmationGate {
  const gate = new ConfirmationGate(vi.fn());
  vi.spyOn(gate, "request").mockResolvedValue(approved);
  return gate;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("RunTerminalTool", () => {
  it("returns stdout and exitCode 0 for a successful command", async () => {
    mockSpawn.mockReturnValueOnce(makeChild("hello\n", "", 0) as ReturnType<typeof spawn>);

    const tool = new RunTerminalTool(makeGate(true), "never");
    const result = await tool.execute(params({ command: "echo hello" }));

    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output);
    expect(parsed.stdout).toBe("hello\n");
    expect(parsed.exitCode).toBe(0);
  });

  it("returns success:false and exitCode for a failing command", async () => {
    mockSpawn.mockReturnValueOnce(makeChild("", "error: not found", 1) as ReturnType<typeof spawn>);

    const tool = new RunTerminalTool(makeGate(true), "never");
    const result = await tool.execute(params({ command: "badcmd" }));

    expect(result.success).toBe(false);
    const parsed = JSON.parse(result.output);
    expect(parsed.exitCode).toBe(1);
    expect(parsed.stderr).toBe("error: not found");
  });

  it("blocks a command that matches the safety blocklist", async () => {
    const tool = new RunTerminalTool(makeGate(true), "never");
    const result = await tool.execute(params({ command: "rm -rf /" }));

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/blocked/i);
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("blocks case-insensitively (SHUTDOWN)", async () => {
    const tool = new RunTerminalTool(makeGate(true), "never");
    const result = await tool.execute(params({ command: "SHUTDOWN /s" }));

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/blocked/i);
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("calls the confirmation gate in 'ask' mode", async () => {
    mockSpawn.mockReturnValueOnce(makeChild("ok", "", 0) as ReturnType<typeof spawn>);

    const gate = makeGate(true);
    const tool = new RunTerminalTool(gate, "ask");
    await tool.execute(params({ command: "ls" }));

    expect(gate.request).toHaveBeenCalledOnce();
    expect(mockSpawn).toHaveBeenCalled();
  });

  it("returns failure when user rejects the confirmation", async () => {
    const gate = makeGate(false);
    const tool = new RunTerminalTool(gate, "ask");
    const result = await tool.execute(params({ command: "ls" }));

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/rejected/i);
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("skips confirmation gate in 'never' mode", async () => {
    mockSpawn.mockReturnValueOnce(makeChild("out", "", 0) as ReturnType<typeof spawn>);

    const gate = makeGate(true);
    const tool = new RunTerminalTool(gate, "never");
    const result = await tool.execute(params({ command: "echo test" }));

    expect(result.success).toBe(true);
    expect(gate.request).not.toHaveBeenCalled();
  });

  it("returns failure when command parameter is missing", async () => {
    const tool = new RunTerminalTool(makeGate(), "never");
    const result = await tool.execute(params());
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/command/i);
  });
});
