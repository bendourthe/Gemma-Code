import { describe, it, expect } from "vitest";
import { LoopGuards, DEFAULT_LOOP_GUARDS, clampAgentIterations, HARD_AGENT_ITERATION_CEILING } from "../../../modules/coding/guardrails/LoopGuards.js";
import type { ToolCall } from "../../../src/tools/types.js";

function call(tool: string, path: string): ToolCall {
  return { tool, id: `id-${Math.random()}`, parameters: { path } };
}

describe("LoopGuards", () => {
  it("exposes one config object for every threshold", () => {
    expect(DEFAULT_LOOP_GUARDS.identicalCallConsecutive).toBe(5);
    expect(DEFAULT_LOOP_GUARDS.noActionBudget).toBe(3);
    expect(DEFAULT_LOOP_GUARDS.errorBurst).toBe(4);
    expect(DEFAULT_LOOP_GUARDS.maxExecuting + DEFAULT_LOOP_GUARDS.maxPending).toBe(5);
    expect(DEFAULT_LOOP_GUARDS.maxIterations).toBe(HARD_AGENT_ITERATION_CEILING);
  });

  it("identical-call veto halts after N consecutive identical calls", () => {
    const guards = new LoopGuards({ identicalCallConsecutive: 5 });
    const same = call("read_file", "a.ts");
    let last = guards.recordToolCall(same);
    for (let i = 1; i < 4; i++) {
      last = guards.recordToolCall(same);
      expect(last.action).not.toBe("halt");
    }
    expect(last.action).toBe("warn");
    const halt = guards.recordToolCall(same);
    expect(halt.action).toBe("halt");
    expect(halt.guard).toBe("identical-call");
    expect(halt.message).toMatch(/session is still open/i);
  });

  it("recordIteration halts past the configured ceiling", () => {
    const guards = new LoopGuards({ maxIterations: 2 });
    expect(guards.recordIteration().action).toBe("ok");
    expect(guards.recordIteration().action).toBe("ok");
    const halt = guards.recordIteration();
    expect(halt.action).toBe("halt");
    expect(halt.guard).toBe("iteration-ceiling");
  });

  it("a different call resets the identical streak", () => {
    const guards = new LoopGuards({ identicalCallConsecutive: 3 });
    const a = call("read_file", "a.ts");
    guards.recordToolCall(a);
    guards.recordToolCall(a);
    const mixed = guards.recordToolCall(call("read_file", "b.ts"));
    expect(mixed.action).toBe("ok");
  });

  it("no-action budget halts after N tool-less turns", () => {
    const guards = new LoopGuards({ noActionBudget: 3 });
    expect(guards.recordNoAction().action).toBe("ok");
    expect(guards.recordNoAction().action).toBe("ok");
    const halt = guards.recordNoAction();
    expect(halt.action).toBe("halt");
    expect(halt.guard).toBe("no-action");
  });

  it("a tool call resets the no-action streak", () => {
    const guards = new LoopGuards({ noActionBudget: 2 });
    guards.recordNoAction();
    guards.recordToolCall(call("read_file", "a.ts"));
    expect(guards.recordNoAction().action).toBe("ok");
  });

  it("error-burst guard halts after N consecutive failures", () => {
    const guards = new LoopGuards({ errorBurst: 4 });
    expect(guards.recordToolOutcome(false).action).toBe("ok");
    expect(guards.recordToolOutcome(false).action).toBe("ok");
    expect(guards.recordToolOutcome(false).action).toBe("ok");
    const halt = guards.recordToolOutcome(false);
    expect(halt.action).toBe("halt");
    expect(halt.guard).toBe("error-burst");
  });

  it("a success resets the error burst", () => {
    const guards = new LoopGuards({ errorBurst: 2 });
    guards.recordToolOutcome(false);
    guards.recordToolOutcome(true);
    expect(guards.recordToolOutcome(false).action).toBe("ok");
  });

  it("bounded queue keeps 1 executing + 4 pending", () => {
    const guards = new LoopGuards();
    const fit = guards.admit(5);
    expect(fit.admitted).toBe(5);
    expect(fit.dropped).toBe(0);
    const overflow = guards.admit(10);
    expect(overflow.admitted).toBe(5);
    expect(overflow.dropped).toBe(5);
    expect(overflow.verdict.action).toBe("warn");
    expect(overflow.verdict.guard).toBe("bounded-queue");
  });

  it("a mixed multi-step sequence does not trip any guard", () => {
    const guards = new LoopGuards();
    expect(guards.recordToolCall(call("read_file", "a.ts")).action).toBe("ok");
    expect(guards.recordToolOutcome(true).action).toBe("ok");
    expect(guards.recordToolCall(call("edit_file", "a.ts")).action).toBe("ok");
    expect(guards.recordToolOutcome(true).action).toBe("ok");
    expect(guards.admit(2).dropped).toBe(0);
  });

  it("clampAgentIterations never exceeds the hard ceiling", () => {
    expect(clampAgentIterations(500)).toBe(HARD_AGENT_ITERATION_CEILING);
    expect(clampAgentIterations(20)).toBe(20);
    expect(clampAgentIterations(-1)).toBe(0);
  });
});
