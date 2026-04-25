import { describe, it, expect, beforeEach } from "vitest";
import { LoopDetector } from "../../../src/guardrails/LoopDetector.js";
import type { ToolCall } from "../../../src/tools/types.js";

function makeCall(tool: string, params: Record<string, unknown> = {}): ToolCall {
  return { tool: tool as ToolCall["tool"], id: `call_${Math.random()}`, parameters: params };
}

describe("LoopDetector", () => {
  let detector: LoopDetector;

  beforeEach(() => {
    detector = new LoopDetector({ windowSize: 4, repeatThreshold: 3 });
  });

  it("returns ok for non-repeating calls", () => {
    const v1 = detector.record(makeCall("read_file", { path: "a.ts" }));
    const v2 = detector.record(makeCall("read_file", { path: "b.ts" }));
    const v3 = detector.record(makeCall("write_file", { path: "c.ts", content: "x" }));

    expect(v1.action).toBe("ok");
    expect(v2.action).toBe("ok");
    expect(v3.action).toBe("ok");
  });

  it("returns warn when repeat threshold is met", () => {
    const call = makeCall("read_file", { path: "same.ts" });

    detector.record(call);
    detector.record(call);
    const v3 = detector.record(call);

    expect(v3.action).toBe("warn");
    expect(v3.message).toContain("Possible loop");
    expect(v3.message).toContain("read_file");
  });

  it("returns terminate when pattern persists after warning", () => {
    const call = makeCall("read_file", { path: "same.ts" });

    detector.record(call);
    detector.record(call);
    const warn = detector.record(call);
    expect(warn.action).toBe("warn");

    // One more identical call should terminate.
    const terminate = detector.record(call);
    expect(terminate.action).toBe("terminate");
    expect(terminate.message).toContain("Terminating");
  });

  it("does not trigger when calls differ", () => {
    for (let i = 0; i < 10; i++) {
      const v = detector.record(makeCall("read_file", { path: `file_${i}.ts` }));
      expect(v.action).toBe("ok");
    }
  });

  it("resets warning state and hash buffer", () => {
    const call = makeCall("read_file", { path: "same.ts" });

    detector.record(call);
    detector.record(call);
    const warn = detector.record(call);
    expect(warn.action).toBe("warn");

    detector.reset();

    // After reset, the same call should start fresh.
    const fresh = detector.record(call);
    expect(fresh.action).toBe("ok");
  });

  it("respects window size (old entries slide out)", () => {
    const repeated = makeCall("read_file", { path: "same.ts" });
    const different = makeCall("write_file", { path: "other.ts", content: "y" });

    // Fill window: [repeated, repeated, different, different]
    detector.record(repeated);
    detector.record(repeated);
    detector.record(different);
    detector.record(different);

    // Now the repeated call is only once in the window (oldest two slid out).
    // Adding another repeated: [repeated, different, different, repeated] -> 2 repeats, under threshold.
    const v = detector.record(repeated);
    expect(v.action).toBe("ok");
  });

  it("strips id and _callId from hash computation", () => {
    // Two calls with different ids but same tool/params should be treated as identical.
    const call1: ToolCall = {
      tool: "read_file",
      id: "call_001",
      parameters: { path: "a.ts", _callId: "cid_001" },
    };
    const call2: ToolCall = {
      tool: "read_file",
      id: "call_002",
      parameters: { path: "a.ts", _callId: "cid_002" },
    };
    const call3: ToolCall = {
      tool: "read_file",
      id: "call_003",
      parameters: { path: "a.ts", _callId: "cid_003" },
    };

    detector.record(call1);
    detector.record(call2);
    const v3 = detector.record(call3);

    expect(v3.action).toBe("warn");
  });

  it("uses custom window size and threshold", () => {
    const custom = new LoopDetector({ windowSize: 2, repeatThreshold: 2 });
    const call = makeCall("grep_codebase", { pattern: "TODO" });

    custom.record(call);
    const v2 = custom.record(call);
    expect(v2.action).toBe("warn");
  });

  it("uses default config when none provided", () => {
    const defaultDetector = new LoopDetector();
    const call = makeCall("read_file", { path: "same.ts" });

    // Default: windowSize=4, repeatThreshold=3
    defaultDetector.record(call);
    defaultDetector.record(call);
    const v3 = defaultDetector.record(call);
    expect(v3.action).toBe("warn");
  });
});
