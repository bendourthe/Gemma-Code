import { describe, it, expect } from "vitest";
import {
  PlanMode,
  detectPlan,
  PLAN_MODE_SYSTEM_ADDENDUM,
  PLAN_MODE_CAPABILITIES_REMINDER,
  PLAN_DENIAL_TEMPLATE,
  PLAN_APPROVED_WITH_NOTES_TEMPLATE,
  buildDenialMessage,
  buildApprovedWithNotesMessage,
} from "../../../src/chat/PlanMode.js";

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

  it("denyPlan() returns the rendered denial template with feedback inlined", () => {
    const pm = new PlanMode();
    pm.setPlan(["Step A", "Step B"]);
    pm.approveStep(0);
    const msg = pm.denyPlan("step 2 deletes production data");
    expect(msg).toContain("YOUR PLAN WAS NOT APPROVED");
    expect(msg).toContain("Do NOT resubmit the same plan unchanged");
    expect(msg).toContain("step 2 deletes production data");
  });

  it("denyPlan() resets non-done steps to pending and clears the step pointer", () => {
    const pm = new PlanMode();
    pm.setPlan(["Step A", "Step B"]);
    pm.approveStep(0);
    pm.markStepDone(0);
    pm.approveStep(1);
    pm.denyPlan("reconsider step 2");
    expect(pm.state.currentStep).toBe(0);
    expect(pm.state.currentPlan[0]?.status).toBe("done"); // done preserved
    expect(pm.state.currentPlan[1]?.status).toBe("pending"); // approved reverts
  });

  it("approveWithNotes() approves every non-done step and returns the rendered notes template", () => {
    const pm = new PlanMode();
    pm.setPlan(["Step A", "Step B", "Step C"]);
    pm.markStepDone(0);
    const msg = pm.approveWithNotes("prefer dependency injection over globals");
    expect(msg).toContain("Plan approved with notes!");
    expect(msg).toContain("Implementation Notes");
    expect(msg).toContain("prefer dependency injection over globals");
    expect(pm.state.currentPlan[0]?.status).toBe("done");
    expect(pm.state.currentPlan[1]?.status).toBe("approved");
    expect(pm.state.currentPlan[2]?.status).toBe("approved");
    expect(pm.state.currentStep).toBe(3);
  });
});

describe("PlanMode annotations (Phase 3.1)", () => {
  const baseAnnotation = (overrides = {}) => ({
    id: "a1",
    blockId: "step-1",
    startOffset: 0,
    endOffset: 4,
    type: "COMMENT" as const,
    text: "Inline a check.",
    originalText: "step",
    ...overrides,
  });

  it("addAnnotation() appends rows and returns the new length", () => {
    const pm = new PlanMode();
    expect(pm.addAnnotation(baseAnnotation())).toBe(1);
    expect(pm.addAnnotation(baseAnnotation({ id: "a2" }))).toBe(2);
    expect(pm.getAnnotations()).toHaveLength(2);
  });

  it("addAnnotation() replaces an existing row when the id matches", () => {
    const pm = new PlanMode();
    pm.addAnnotation(baseAnnotation({ text: "first body" }));
    pm.addAnnotation(baseAnnotation({ text: "second body" }));
    expect(pm.getAnnotations()).toHaveLength(1);
    expect(pm.getAnnotations()[0]?.text).toBe("second body");
  });

  it("removeAnnotation() drops the matching row and returns true", () => {
    const pm = new PlanMode();
    pm.addAnnotation(baseAnnotation());
    pm.addAnnotation(baseAnnotation({ id: "a2" }));
    expect(pm.removeAnnotation("a1")).toBe(true);
    expect(pm.getAnnotations()).toHaveLength(1);
    expect(pm.getAnnotations()[0]?.id).toBe("a2");
  });

  it("removeAnnotation() returns false when the id is not buffered", () => {
    const pm = new PlanMode();
    pm.addAnnotation(baseAnnotation());
    expect(pm.removeAnnotation("missing")).toBe(false);
    expect(pm.getAnnotations()).toHaveLength(1);
  });

  it("setPlan() and resetPlan() both clear the annotation buffer", () => {
    const pm = new PlanMode();
    pm.addAnnotation(baseAnnotation());
    pm.setPlan(["Step A"]);
    expect(pm.getAnnotations()).toHaveLength(0);
    pm.addAnnotation(baseAnnotation());
    pm.resetPlan();
    expect(pm.getAnnotations()).toHaveLength(0);
  });

  it("clearAnnotations() empties the buffer", () => {
    const pm = new PlanMode();
    pm.addAnnotation(baseAnnotation());
    pm.addAnnotation(baseAnnotation({ id: "a2" }));
    pm.clearAnnotations();
    expect(pm.getAnnotations()).toHaveLength(0);
  });

  it("formatAnnotationsAsFeedback() returns an empty string when no annotations", () => {
    const pm = new PlanMode();
    expect(pm.formatAnnotationsAsFeedback()).toBe("");
  });

  it("formatAnnotationsAsFeedback() renders DELETION, COMMENT, GLOBAL_COMMENT rows", () => {
    const pm = new PlanMode();
    pm.addAnnotation(
      baseAnnotation({
        id: "a1",
        type: "DELETION",
        originalText: "rm -rf /",
        text: undefined,
      }),
    );
    pm.addAnnotation(
      baseAnnotation({
        id: "a2",
        type: "COMMENT",
        originalText: "compile module",
        text: "Inline a check.",
      }),
    );
    pm.addAnnotation(
      baseAnnotation({
        id: "a3",
        type: "GLOBAL_COMMENT",
        originalText: "",
        text: "Touches migration; add backup.",
      }),
    );
    const out = pm.formatAnnotationsAsFeedback();
    expect(out).toContain('Delete on "rm -rf /"');
    expect(out).toContain('Comment on "compile module": Inline a check.');
    expect(out).toContain("Global comment: Touches migration; add backup.");
  });

  it("falls back to quickLabelTip when text is empty in formatAnnotationsAsFeedback", () => {
    const pm = new PlanMode();
    pm.addAnnotation(
      baseAnnotation({
        type: "COMMENT",
        text: undefined,
        quickLabelTip: "Add test coverage.",
      }),
    );
    expect(pm.formatAnnotationsAsFeedback()).toContain("Add test coverage.");
  });
});

describe("PLAN_DENIAL_TEMPLATE", () => {
  it("contains the strong-directive framing", () => {
    expect(PLAN_DENIAL_TEMPLATE).toContain("YOUR PLAN WAS NOT APPROVED");
    expect(PLAN_DENIAL_TEMPLATE).toContain("Do NOT resubmit");
    expect(PLAN_DENIAL_TEMPLATE).toContain("{{feedback}}");
  });

  it("buildDenialMessage() substitutes feedback and trims surrounding whitespace", () => {
    const out = buildDenialMessage("  please drop step 3  ");
    expect(out).toContain("please drop step 3");
    expect(out).not.toContain("{{feedback}}");
    expect(out).not.toContain("  please drop");
  });
});

describe("PLAN_APPROVED_WITH_NOTES_TEMPLATE", () => {
  it("contains the implementation-notes framing", () => {
    expect(PLAN_APPROVED_WITH_NOTES_TEMPLATE).toContain("Plan approved with notes");
    expect(PLAN_APPROVED_WITH_NOTES_TEMPLATE).toContain("Implementation Notes");
    expect(PLAN_APPROVED_WITH_NOTES_TEMPLATE).toContain("{{notes}}");
  });

  it("buildApprovedWithNotesMessage() substitutes notes", () => {
    const out = buildApprovedWithNotesMessage("use vitest fake timers");
    expect(out).toContain("use vitest fake timers");
    expect(out).not.toContain("{{notes}}");
  });
});

describe("PLAN_MODE_CAPABILITIES_REMINDER", () => {
  it("lists the v0.7.0 Phase 4 render primitives", () => {
    expect(PLAN_MODE_CAPABILITIES_REMINDER).toContain("TODO_BLOCK");
    expect(PLAN_MODE_CAPABILITIES_REMINDER).toContain("DIFF_CARD");
    expect(PLAN_MODE_CAPABILITIES_REMINDER).toContain("ACTION_TAG");
    expect(PLAN_MODE_CAPABILITIES_REMINDER).toContain("PERMISSION_PROMPT");
    expect(PLAN_MODE_CAPABILITIES_REMINDER).toContain("THOUGHT_META_ROW");
    expect(PLAN_MODE_CAPABILITIES_REMINDER).toContain("QUEUED_MESSAGE_FIELD");
    expect(PLAN_MODE_CAPABILITIES_REMINDER).toContain("COMPLETION_REPORT");
  });
});
