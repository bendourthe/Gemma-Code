import { describe, it, expect } from "vitest";
import {
  computeRoutingSignals,
  hashToolCall,
  type RoutingTurnEvent,
} from "../../../../modules/coding/orchestration/routing/RoutingSignals.js";

function ev(over: Partial<RoutingTurnEvent> & { turn: number }): RoutingTurnEvent {
  return {
    sessionId: "s1",
    role: "worker",
    ...over,
  };
}

describe("computeRoutingSignals", () => {
  it("counts consecutive tool errors from the tail", () => {
    const events = [
      ev({ turn: 1, toolName: "read", toolError: false }),
      ev({ turn: 2, toolName: "edit", toolError: true }),
      ev({ turn: 3, toolName: "edit", toolError: true }),
      ev({ turn: 4, toolName: "edit", toolError: true }),
    ];
    const s = computeRoutingSignals(events, "s1");
    expect(s.consecutiveToolErrors).toBe(3);
  });

  it("treats stale and other-session events as neutral", () => {
    const events = [
      ev({ turn: 1, toolError: true, stale: true }),
      ev({ turn: 2, toolError: true, sessionId: "other" }),
      ev({ turn: 3, toolName: "read", toolError: false }),
    ];
    const s = computeRoutingSignals(events, "s1");
    expect(s.consecutiveToolErrors).toBe(0);
  });

  it("malformed turns without a finite turn are skipped", () => {
    const events = [{ sessionId: "s1", turn: Number.NaN, toolError: true } as RoutingTurnEvent];
    expect(computeRoutingSignals(events, "s1").consecutiveToolErrors).toBe(0);
  });

  it("detects identical tool+args repeats", () => {
    const hash = hashToolCall("edit", { path: "a.ts" });
    const events = [1, 2, 3].map((turn) =>
      ev({ turn, toolName: "edit", toolArgsHash: hash }),
    );
    expect(computeRoutingSignals(events, "s1").identicalActionRepeats).toBe(3);
  });

  it("counts progress-free worker steps until a mutation", () => {
    const events = [
      ev({ turn: 1, fileMutated: false }),
      ev({ turn: 2, fileMutated: false }),
      ev({ turn: 3, fileMutated: true }),
      ev({ turn: 4, fileMutated: false }),
      ev({ turn: 5, fileMutated: false }),
    ];
    expect(computeRoutingSignals(events, "s1").stepsWithoutProgress).toBe(2);
  });

  it("empty session id is stale-neutral", () => {
    const s = computeRoutingSignals([ev({ turn: 1, toolError: true })], "");
    expect(s.stale).toBe(true);
    expect(s.consecutiveToolErrors).toBe(0);
  });
});
