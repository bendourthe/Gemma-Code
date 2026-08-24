import { describe, it, expect } from "vitest";
import { InProcessTelemetryBus } from "../../../../core/telemetry/TelemetryBus.js";
import {
  EscalationPolicy,
  parseRoutingConfig,
  pickWorkerCandidate,
  DEFAULT_ROUTING_POLICY,
  type RoutingModels,
} from "../../../../modules/coding/orchestration/routing/EscalationPolicy.js";
import { routeTurn } from "../../../../modules/coding/orchestration/routing/routeTurn.js";
import type { RoutingTurnEvent } from "../../../../modules/coding/orchestration/routing/RoutingSignals.js";

const MODELS: RoutingModels = {
  workerId: "nemotron-lightning:30b-a3b",
  strongId: "muse-glimmer:30b",
  installed: new Set(["nemotron-lightning:30b-a3b", "muse-glimmer:30b"]),
};

function errors(n: number): RoutingTurnEvent[] {
  return Array.from({ length: n }, (_, i) => ({
    sessionId: "s",
    turn: i + 1,
    role: "worker" as const,
    toolName: "edit",
    toolError: true,
  }));
}

describe("EscalationPolicy", () => {
  it("pins planner and critic to the strong model", () => {
    const policy = new EscalationPolicy();
    const d = policy.acknowledge(
      policy.decide({
        sessionId: "s",
        turn: 1,
        role: "planner",
        events: [],
        models: MODELS,
      }),
    );
    expect(d.action).toBe("pin");
    expect(d.modelId).toBe("muse-glimmer:30b");
    expect(d.reason).toBe("role-pin-strong");
  });

  it("starts workers cheap-first on the worker-candidate", () => {
    const policy = new EscalationPolicy();
    const d = policy.acknowledge(
      policy.decide({
        sessionId: "s",
        turn: 1,
        role: "worker",
        events: [],
        models: MODELS,
      }),
    );
    expect(d.modelId).toBe("nemotron-lightning:30b-a3b");
    expect(d.action).toBe("hold");
  });

  it("escalates a worker after 3 consecutive tool errors", () => {
    const policy = new EscalationPolicy();
    policy.acknowledge(
      policy.decide({
        sessionId: "s",
        turn: 1,
        role: "worker",
        events: [],
        models: MODELS,
      }),
    );
    const d = policy.acknowledge(
      policy.decide({
        sessionId: "s",
        turn: 4,
        role: "worker",
        events: errors(3),
        models: MODELS,
      }),
    );
    expect(d.action).toBe("escalate");
    expect(d.modelId).toBe("muse-glimmer:30b");
    expect(d.reason).toBe("tool-error-streak");
  });

  it("cooldown wins over a conflicting escalate signal", () => {
    const policy = new EscalationPolicy({ cooldownTurns: 3, minTurnsOnModel: 1 });
    policy.acknowledge(
      policy.decide({ sessionId: "s", turn: 1, role: "worker", events: [], models: MODELS }),
    );
    policy.acknowledge(
      policy.decide({ sessionId: "s", turn: 4, role: "worker", events: errors(3), models: MODELS }),
    );
    policy.acknowledge(
      policy.decide({
        sessionId: "s",
        turn: 5,
        role: "worker",
        events: [{ sessionId: "s", turn: 5, role: "worker", fileMutated: true, toolName: "edit" }],
        models: MODELS,
      }),
    );
    const held = policy.acknowledge(
      policy.decide({ sessionId: "s", turn: 6, role: "worker", events: errors(8), models: MODELS }),
    );
    expect(held.action).toBe("hold");
    expect(held.reason).toBe("cooldown-holds");
    expect(held.deferred).toBe(true);
    expect(held.modelId).toBe("nemotron-lightning:30b-a3b");
  });

  it("stays on the worker when the strong model is unavailable", () => {
    const policy = new EscalationPolicy();
    const models: RoutingModels = {
      ...MODELS,
      installed: new Set(["nemotron-lightning:30b-a3b"]),
    };
    const d = policy.acknowledge(
      policy.decide({
        sessionId: "s",
        turn: 4,
        role: "worker",
        events: errors(3),
        models,
      }),
    );
    expect(d.modelId).toBe("nemotron-lightning:30b-a3b");
    expect(d.notice).toBe("strong-unavailable");
  });

  it("de-escalates after recovery and min turns on the strong model", () => {
    const policy = new EscalationPolicy({ minTurnsOnModel: 2, cooldownTurns: 0 });
    policy.acknowledge(
      policy.decide({
        sessionId: "s",
        turn: 1,
        role: "worker",
        events: [],
        models: MODELS,
      }),
    );
    policy.acknowledge(
      policy.decide({
        sessionId: "s",
        turn: 4,
        role: "worker",
        events: errors(3),
        models: MODELS,
      }),
    );
    policy.acknowledge(
      policy.decide({
        sessionId: "s",
        turn: 5,
        role: "worker",
        events: [
          ...errors(3),
          { sessionId: "s", turn: 5, role: "worker", fileMutated: true, toolName: "edit" },
        ],
        models: MODELS,
      }),
    );
    const down = policy.acknowledge(
      policy.decide({
        sessionId: "s",
        turn: 6,
        role: "worker",
        events: [
          { sessionId: "s", turn: 6, role: "worker", fileMutated: true, toolName: "edit" },
        ],
        models: MODELS,
      }),
    );
    expect(down.action).toBe("de-escalate");
    expect(down.modelId).toBe("nemotron-lightning:30b-a3b");
  });

  it("enforces the session swap budget", () => {
    const policy = new EscalationPolicy({ swapBudget: 1, cooldownTurns: 0, minTurnsOnModel: 1 });
    policy.acknowledge(
      policy.decide({ sessionId: "s", turn: 1, role: "worker", events: [], models: MODELS }),
    );
    policy.acknowledge(
      policy.decide({ sessionId: "s", turn: 4, role: "worker", events: errors(3), models: MODELS }),
    );
    policy.acknowledge(
      policy.decide({
        sessionId: "s",
        turn: 5,
        role: "worker",
        events: [{ sessionId: "s", turn: 5, role: "worker", fileMutated: true, toolName: "x" }],
        models: MODELS,
      }),
    );
    const blocked = policy.acknowledge(
      policy.decide({ sessionId: "s", turn: 10, role: "worker", events: errors(8), models: MODELS }),
    );
    expect(blocked.reason === "swap-budget" || blocked.action === "hold").toBe(true);
  });

  it("emits routing.decision telemetry", () => {
    const bus = new InProcessTelemetryBus();
    const seen: unknown[] = [];
    bus.subscribe({ kinds: ["routing.decision"] }, (e) => seen.push(e.payload));
    const policy = new EscalationPolicy(DEFAULT_ROUTING_POLICY, bus);
    policy.acknowledge(
      policy.decide({ sessionId: "s", turn: 1, role: "planner", events: [], models: MODELS }),
    );
    expect(seen).toHaveLength(1);
  });

  it("rejects malformed config and uses compiled defaults", () => {
    const parsed = parseRoutingConfig("nope");
    expect(parsed.rejected).toBe(true);
    expect(parsed.config).toEqual(DEFAULT_ROUTING_POLICY);
    const policy = new EscalationPolicy("nope");
    expect(policy.usedDefaultsAfterReject).toBe(true);
  });

  it("pickWorkerCandidate prefers a non-offload installed id", () => {
    const id = pickWorkerCandidate(
      [
        { id: "nemotron-lightning:30b-a3b-offload", role: "worker-candidate" },
        { id: "nemotron-lightning:30b-a3b", role: "worker-candidate" },
      ],
      new Set(["nemotron-lightning:30b-a3b", "nemotron-lightning:30b-a3b-offload"]),
    );
    expect(id).toBe("nemotron-lightning:30b-a3b");
  });

  it("routeTurn with infinite VRAM honors an escalation", () => {
    const policy = new EscalationPolicy();
    policy.acknowledge(
      policy.decide({ sessionId: "s", turn: 1, role: "worker", events: [], models: MODELS }),
    );
    const d = routeTurn(policy, {
      sessionId: "s",
      turn: 4,
      role: "worker",
      events: errors(3),
      models: MODELS,
      vramFor: () => 8,
    });
    expect(d.action).toBe("escalate");
    expect(d.swapOutcome).toBe("honored");
  });

  it("routeTurn defers when the scheduler reports a VRAM no-fit", () => {
    const policy = new EscalationPolicy();
    policy.acknowledge(
      policy.decide({ sessionId: "s", turn: 1, role: "worker", events: [], models: MODELS }),
    );
    const d = routeTurn(
      policy,
      {
        sessionId: "s",
        turn: 4,
        role: "worker",
        events: errors(3),
        models: MODELS,
        vramFor: () => 8,
      },
      {
        evaluateRoutingSwap: () => ({
          outcome: "deferred",
          keepWorkerResident: true,
          reason: "insufficient-free-vram",
        }),
      },
    );
    expect(d.action).toBe("hold");
    expect(d.swapOutcome).toBe("deferred");
    expect(d.deferred).toBe(true);
  });
});
