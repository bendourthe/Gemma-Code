import { describe, it, expect } from "vitest";
import { PlanMode, detectPlan, PLAN_MODE_SYSTEM_ADDENDUM } from "../../../src/modes/PlanMode.js";

describe("detectPlan()", () => {
  it("returns null when response has no numbered list", () => {
    expect(detectPlan("This is a normal response without any plan.")).toBeNull();
  });

  it("returns null when response has only one numbered item", () => {
    expect(detectPlan("1. Only one step here.\nNo more steps.")).toBeNull();
  });

  it("returns step descriptions when response has ≥2 numbered items in first 500 chars", () => {
    const response =
      "Here is my plan:\n1. Read the file\n2. Analyse the code\n3. Write a fix";
    const steps = detectPlan(response);
    expect(steps).not.toBeNull();
    expect(steps).toHaveLength(3);
    expect(steps?.[0]).toBe("Read the file");
    expect(steps?.[1]).toBe("Analyse the code");
    expect(steps?.[2]).toBe("Write a fix");
  });

  it("returns null when numbered items appear only after the first 500 characters", () => {
    const longPreamble = "x".repeat(510);
    const response = longPreamble + "\n1. Step one\n2. Step two";
    expect(detectPlan(response)).toBeNull();
  });

  it("extracts all numbered steps from the full response even when preamble is short", () => {
    const lines = Array.from({ length: 10 }, (_, i) => `${i + 1}. Step ${i + 1}`).join("\n");
    const steps = detectPlan("Plan:\n" + lines);
    expect(steps).toHaveLength(10);
  });
});

describe("PLAN_MODE_SYSTEM_ADDENDUM", () => {
  it("contains the plan mode instruction", () => {
    expect(PLAN_MODE_SYSTEM_ADDENDUM).toContain("PLAN MODE");
    expect(PLAN_MODE_SYSTEM_ADDENDUM).toContain("numbered plan");
  });
});

describe("PlanMode", () => {
  it("starts inactive with an empty plan", () => {
    const pm = new PlanMode();
    expect(pm.active).toBe(false);
    expect(pm.state.currentPlan).toHaveLength(0);
    expect(pm.state.currentStep).toBe(0);
  });

  it("toggle() activates plan mode and returns true", () => {
    const pm = new PlanMode();
    expect(pm.toggle()).toBe(true);
    expect(pm.active).toBe(true);
  });

  it("toggle() deactivates plan mode on second call", () => {
    const pm = new PlanMode();
    pm.toggle();
    expect(pm.toggle()).toBe(false);
    expect(pm.active).toBe(false);
  });

  it("toggle() clears the plan when deactivating", () => {
    const pm = new PlanMode();
    pm.toggle();
    pm.setPlan(["Step A", "Step B"]);
    pm.toggle(); // deactivate
    expect(pm.state.currentPlan).toHaveLength(0);
    expect(pm.state.currentStep).toBe(0);
  });

  it("setPlan() stores steps as pending PlanStep objects", () => {
    const pm = new PlanMode();
    pm.setPlan(["Read file", "Write fix"]);
    const { currentPlan } = pm.state;
    expect(currentPlan).toHaveLength(2);
    expect(currentPlan[0]).toMatchObject({ index: 0, description: "Read file", status: "pending" });
    expect(currentPlan[1]).toMatchObject({ index: 1, description: "Write fix", status: "pending" });
  });

  it("approveStep() marks the step approved and advances currentStep", () => {
    const pm = new PlanMode();
    pm.setPlan(["Step A", "Step B", "Step C"]);
    pm.approveStep(0);
    expect(pm.state.currentPlan[0]?.status).toBe("approved");
    expect(pm.state.currentStep).toBe(1);
  });

  it("markStepDone() marks the step as done", () => {
    const pm = new PlanMode();
    pm.setPlan(["Step A"]);
    pm.approveStep(0);
    pm.markStepDone(0);
    expect(pm.state.currentPlan[0]?.status).toBe("done");
  });

  it("approveStep() with an out-of-range index does nothing", () => {
    const pm = new PlanMode();
    pm.setPlan(["Step A"]);
    pm.approveStep(99); // no-op
    expect(pm.state.currentStep).toBe(0);
  });

  it("resetPlan() clears steps without changing active flag", () => {
    const pm = new PlanMode();
    pm.toggle(); // active = true
    pm.setPlan(["Step A", "Step B"]);
    pm.resetPlan();
    expect(pm.active).toBe(true);
    expect(pm.state.currentPlan).toHaveLength(0);
    expect(pm.state.currentStep).toBe(0);
  });

  it("state getter returns a snapshot, not a live reference", () => {
    const pm = new PlanMode();
    pm.setPlan(["Step A", "Step B"]);
    const snapshot = pm.state;
    pm.approveStep(0);
    // Snapshot should not reflect the mutation.
    expect(snapshot.currentPlan[0]?.status).toBe("pending");
  });
});
