import { EventEmitter } from "events";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { RunTerminalTool } from "../../../src/tools/handlers/terminal.js";
import { scrubEnv } from "../../../core/observability/scrubEnv.js";

vi.mock("child_process", () => ({
  spawn: vi.fn(),
}));

import { spawn } from "child_process";
const mockSpawn = vi.mocked(spawn);

function makeChild(): ReturnType<typeof spawn> {
  const child = new EventEmitter() as ReturnType<typeof spawn>;
  (child as unknown as { stdout: EventEmitter; stderr: EventEmitter }).stdout = new EventEmitter();
  (child as unknown as { stderr: EventEmitter }).stderr = new EventEmitter();
  (child as unknown as { kill: () => boolean }).kill = vi.fn(() => true);
  setTimeout(() => child.emit("close", 0), 0);
  return child;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => vi.useRealTimers());

describe("guardrails still apply inside the sandbox wrapper", () => {
  it("env scrub still strips secrets from the child env when sandbox is requested", async () => {
    process.env.NEXUS_TEST_SECRET_TOKEN = "shh";
    try {
      mockSpawn.mockReturnValueOnce(makeChild());
      const tool = new RunTerminalTool(30_000, false, undefined, true, [], null, true);
      await tool.execute({ _callId: "g1", command: "echo hi" });
      expect(mockSpawn).toHaveBeenCalled();
      const opts = mockSpawn.mock.calls[0]![2] as { env?: NodeJS.ProcessEnv };
      const env = opts.env ?? {};
      expect(env.NEXUS_TEST_SECRET_TOKEN).toBeUndefined();
      expect(scrubEnv({ NEXUS_TEST_SECRET_TOKEN: "shh" }).NEXUS_TEST_SECRET_TOKEN).toBeUndefined();
    } finally {
      delete process.env.NEXUS_TEST_SECRET_TOKEN;
    }
  });

  it("blocklist still refuses before any sandbox helper is spawned", async () => {
    const tool = new RunTerminalTool(30_000, false, undefined, true, [], null, true);
    const result = await tool.execute({ _callId: "g2", command: "rm -rf /" });
    expect(result.success).toBe(false);
    expect(mockSpawn).not.toHaveBeenCalled();
  });
});
