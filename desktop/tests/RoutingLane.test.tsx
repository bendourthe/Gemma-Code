import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  RoutingLane,
  routingDecisionsFromTrace,
  type RoutingLaneDecision,
} from "../src/modules/coding/panels/RoutingLane";

const populated: RoutingLaneDecision[] = [
  {
    turn: 1,
    role: "worker",
    modelId: "lightning",
    action: "hold",
    reason: "affinity",
    previousModelId: "lightning",
    modelInstalled: true,
  },
  {
    turn: 4,
    role: "worker",
    modelId: "muse",
    action: "escalate",
    reason: "tool-error-streak",
    previousModelId: "lightning",
    modelInstalled: true,
  },
];

describe("RoutingLane", () => {
  it("renders an empty state when routing is off", () => {
    render(<RoutingLane decisions={[]} />);
    expect(screen.getByTestId("trace-routing-empty")).toBeInTheDocument();
    expect(screen.getByTestId("trace-routing-swap-count")).toHaveTextContent("0 swaps");
  });

  it("renders per-step models and escalation markers", () => {
    render(<RoutingLane decisions={populated} />);
    expect(screen.getByTestId("trace-routing-model-1")).toHaveTextContent("lightning");
    expect(screen.getByTestId("trace-routing-model-4")).toHaveTextContent("muse");
    expect(screen.getByTestId("trace-routing-escalation-4")).toBeInTheDocument();
    expect(screen.getByTestId("trace-routing-swap-count")).toHaveTextContent("1 swap");
  });

  it("degrades an uninstalled model to the id plus a note", () => {
    render(
      <RoutingLane
        decisions={[
          {
            turn: 2,
            role: "worker",
            modelId: "gone-model",
            action: "hold",
            reason: "affinity",
            modelInstalled: false,
          },
        ]}
      />,
    );
    expect(screen.getByTestId("trace-routing-uninstalled-2")).toBeInTheDocument();
    expect(screen.getByTestId("trace-routing-model-2")).toHaveTextContent("gone-model");
  });

  it("projects a replayed fixture payload into the routing story", () => {
    const derived = routingDecisionsFromTrace([
      { payload: { path: "src/a.ts" } },
      {
        payload: {
          kind: "routing.decision",
          turn: 4,
          role: "worker",
          modelId: "muse-glimmer:30b",
          previousModelId: "nemotron-lightning:30b-a3b",
          action: "escalate",
          reason: "tool-error-streak",
        },
      },
    ]);
    expect(derived).toHaveLength(1);
    expect(derived[0]?.action).toBe("escalate");
    expect(derived[0]?.modelId).toBe("muse-glimmer:30b");
  });
});
