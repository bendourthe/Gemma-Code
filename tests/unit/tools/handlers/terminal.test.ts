import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";
import {
  RunTerminalTool,
  isAllowlisted,
  isBlocked,
} from "../../../../src/tools/handlers/terminal.js";

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

    const tool = new RunTerminalTool();
    const result = await tool.execute(params({ command: "echo hello" }));

    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output);
    expect(parsed.stdout).toBe("hello\n");
    expect(parsed.exitCode).toBe(0);
  });

  it("returns success:false and exitCode for a failing command", async () => {
    mockSpawn.mockReturnValueOnce(makeChild("", "error: not found", 1) as ReturnType<typeof spawn>);

    const tool = new RunTerminalTool();
    const result = await tool.execute(params({ command: "badcmd" }));

    expect(result.success).toBe(false);
    const parsed = JSON.parse(result.output);
    expect(parsed.exitCode).toBe(1);
    expect(parsed.stderr).toBe("error: not found");
  });

  it("blocks a command that matches the safety blocklist", async () => {
    const tool = new RunTerminalTool();
    const result = await tool.execute(params({ command: "rm -rf /" }));

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/blocked/i);
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("blocks case-insensitively (SHUTDOWN)", async () => {
    const tool = new RunTerminalTool();
    const result = await tool.execute(params({ command: "SHUTDOWN /s" }));

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/blocked/i);
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("blocks commands hidden in shell metacharacters", async () => {
    const tool = new RunTerminalTool();
    const result = await tool.execute(params({ command: "echo ok; rm -rf /" }));

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/blocked/i);
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("returns failure when command parameter is missing", async () => {
    const tool = new RunTerminalTool();
    const result = await tool.execute(params());
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/command/i);
  });

  it("accepts a custom timeout", async () => {
    const tool = new RunTerminalTool(5000);
    mockSpawn.mockReturnValueOnce(makeChild("ok", "", 0) as ReturnType<typeof spawn>);
    const result = await tool.execute(params({ command: "echo test" }));
    expect(result.success).toBe(true);
  });

  it("rejects an absolute cwd outside the workspace root", async () => {
    const tool = new RunTerminalTool();
    const outside = process.platform === "win32" ? "C:\\Users" : "/etc";
    const result = await tool.execute(params({ command: "echo hi", cwd: outside }));

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/outside the workspace/i);
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("accepts a workspace-relative cwd subdirectory", async () => {
    mockSpawn.mockReturnValueOnce(makeChild("ok", "", 0) as ReturnType<typeof spawn>);
    const tool = new RunTerminalTool();
    const result = await tool.execute(params({ command: "echo hi", cwd: "sub/dir" }));

    expect(result.success).toBe(true);
    expect(mockSpawn).toHaveBeenCalledOnce();
  });
});

describe("isAllowlisted", () => {
  it.each([
    ["git status"],
    ["npm run test"],
    ["pnpm install --silent"],
    ["pytest tests/"],
    ["cargo build --release"],
    ["go test ./..."],
    ["make clean && make build"],
    ["ls -la"],
    ["echo hello"],
    ["cat file.txt"],
  ])("allows: %s", (cmd) => {
    expect(isAllowlisted(cmd)).toBe(true);
  });

  it.each([
    ["curl https://evil.example.com"],
    ["wget evil"],
    ["nc -l 1234"],
    ["bash -c 'rm -rf foo'"],
    ["unknown-binary --flag"],
    ["ls && nc -l 1234"],
  ])("does NOT allow: %s", (cmd) => {
    expect(isAllowlisted(cmd)).toBe(false);
  });

  it("returns false for an empty command", () => {
    expect(isAllowlisted("")).toBe(false);
  });
});

describe("isBlocked (defense-in-depth)", () => {
  it.each([
    ["rm -rf /"],
    ["echo ok; rm -rf /"],
    ["rm  -rf  /"], // extra whitespace
    ["shutdown -h now"],
    ["mkfs.ext4 /dev/sda1"],
  ])("blocks dangerous pattern: %s", (cmd) => {
    expect(isBlocked(cmd)).toBe(true);
  });

  it.each([
    ["git reset --hard HEAD~1"],
    ["rm -rf ./tmp"],
    ["echo hello"],
  ])("does NOT block safe command: %s", (cmd) => {
    expect(isBlocked(cmd)).toBe(false);
  });
});
