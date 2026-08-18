import { EventEmitter } from "events";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RunTerminalTool } from "../../../../src/tools/handlers/terminal.js";
import { UNCONFINED_TOKEN } from "../../../../modules/coding/sandbox/index.js";

vi.mock("child_process", () => ({
  spawn: vi.fn(),
}));

import { spawn } from "child_process";
const mockSpawn = vi.mocked(spawn);

function makeChild(stdout: string, stderr: string, exitCode: number): ReturnType<typeof spawn> {
  const child = new EventEmitter() as ReturnType<typeof spawn>;
  (child as unknown as { stdout: EventEmitter; stderr: EventEmitter }).stdout = new EventEmitter();
  (child as unknown as { stdout: EventEmitter; stderr: EventEmitter }).stderr = new EventEmitter();
  (child as unknown as { kill: (signal?: string) => boolean }).kill = vi.fn(() => true);
  setTimeout(() => {
    if (stdout) {
      (child as unknown as { stdout: EventEmitter }).stdout.emit("data", Buffer.from(stdout));
    }
    if (stderr) {
      (child as unknown as { stderr: EventEmitter }).stderr.emit("data", Buffer.from(stderr));
    }
    child.emit("close", exitCode);
  }, 0);
  return child;
}

function params(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { _callId: "call_sbx", ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("run_terminal sandbox contract", () => {
  it("keeps spawn(shell:true) when the sandbox is off and still names unconfined", async () => {
    mockSpawn.mockReturnValueOnce(makeChild("hello\n", "", 0));
    const tool = new RunTerminalTool(30_000, false, undefined, true, [], null, false);
    const result = await tool.execute(params({ command: "echo hello" }));
    expect(result.success).toBe(true);
    expect(mockSpawn).toHaveBeenCalledOnce();
    const [command, args, opts] = mockSpawn.mock.calls[0]!;
    expect(command).toBe("echo hello");
    expect(args).toEqual([]);
    expect((opts as { shell?: boolean }).shell).toBe(true);
    const parsed = JSON.parse(result.output);
    expect(parsed.stdout).toBe("hello\n");
    expect(parsed.exitCode).toBe(0);
    expect(parsed.sandbox.mode).toBe("unconfined");
    expect(parsed.sandbox.summary).toContain(UNCONFINED_TOKEN);
  });

  it("still applies env scrub inside the spawn options when sandbox is off", async () => {
    process.env.NEXUS_TEST_SECRET_TOKEN = "shh";
    try {
      mockSpawn.mockReturnValueOnce(makeChild("ok", "", 0));
      const tool = new RunTerminalTool(30_000, false, undefined, true, [], null, false);
      await tool.execute(params({ command: "echo hi" }));
      const env = (mockSpawn.mock.calls[0]![2] as { env?: NodeJS.ProcessEnv }).env ?? {};
      expect(env.NEXUS_TEST_SECRET_TOKEN).toBeUndefined();
    } finally {
      delete process.env.NEXUS_TEST_SECRET_TOKEN;
    }
  });

  it("still blocks destructive commands before spawn when sandbox is on", async () => {
    const tool = new RunTerminalTool(30_000, false, undefined, true, [], null, true);
    const result = await tool.execute(params({ command: "rm -rf /" }));
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/blocked/i);
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("surfaces the unconfined token on dry-run when sandbox is off", async () => {
    const tool = new RunTerminalTool(30_000, false, undefined, true, [], null, false);
    const result = await tool.execute(params({ command: "git status", dry_run: true }));
    expect(result.output).toContain("Sandbox:");
    expect(result.output).toContain(UNCONFINED_TOKEN);
    expect(mockSpawn).not.toHaveBeenCalled();
  });
});
