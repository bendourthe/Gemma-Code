import { describe, it, expect } from "vitest";
import {
  buildPlanArtifact,
  renderPlanArtifactText,
  type PlanArtifactInput,
} from "../../../../core/coding/PlanArtifact.js";

const SAMPLE: PlanArtifactInput = {
  active: true,
  currentStep: 2,
  currentPlan: [
    { index: 1, description: "Read the failing test", status: "done" },
    { index: 2, description: "Reproduce the bug locally", status: "approved" },
    { index: 3, description: "Implement the fix", status: "pending" },
  ],
  annotations: [
    {
      id: "a1",
      blockId: "step-2",
      startOffset: 0,
      endOffset: 5,
      type: "COMMENT",
      originalText: "Repro",
      text: "Add the --debug flag",
    },
  ],
};

describe("buildPlanArtifact", () => {
  it("produces a stable artifact shape with kind='plan-mode'", () => {
    const artifact = buildPlanArtifact(SAMPLE);
    expect(artifact.kind).toBe("plan-mode");
    expect(artifact.active).toBe(true);
    expect(artifact.currentStep).toBe(2);
    expect(artifact.steps).toHaveLength(3);
  });

  it("tags exactly the step matching currentStep as isCurrent", () => {
    const artifact = buildPlanArtifact(SAMPLE);
    const current = artifact.steps.filter((s) => s.isCurrent);
    expect(current).toHaveLength(1);
    expect(current[0]?.index).toBe(2);
  });

  it("normalizes annotation defaults (missing text -> '', missing quickLabelTip -> null)", () => {
    const artifact = buildPlanArtifact({
      ...SAMPLE,
      annotations: [
        {
          id: "x",
          blockId: "step-1",
          startOffset: 0,
          endOffset: 0,
          type: "DELETION",
          originalText: "foo",
        },
      ],
    });
    expect(artifact.annotations[0]?.text).toBe("");
    expect(artifact.annotations[0]?.quickLabelTip).toBeNull();
  });

  it("produces a deterministic fingerprint -- same input yields the same hash", () => {
    const a = buildPlanArtifact(SAMPLE);
    const b = buildPlanArtifact(SAMPLE);
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.fingerprint).toMatch(/^[0-9a-f]{8}$/);
  });

  it("produces a different fingerprint when content changes", () => {
    const a = buildPlanArtifact(SAMPLE);
    const b = buildPlanArtifact({ ...SAMPLE, currentStep: 3 });
    expect(a.fingerprint).not.toBe(b.fingerprint);
  });

  it("freezes the steps and annotations arrays", () => {
    const artifact = buildPlanArtifact(SAMPLE);
    expect(Object.isFrozen(artifact.steps)).toBe(true);
    expect(Object.isFrozen(artifact.annotations)).toBe(true);
  });
});

describe("renderPlanArtifactText", () => {
  it("returns the inactive sentinel when active=false", () => {
    const a = buildPlanArtifact({ ...SAMPLE, active: false });
    expect(renderPlanArtifactText(a)).toBe("Plan mode is inactive.");
  });

  it("renders status markers + the current-step cursor", () => {
    const text = renderPlanArtifactText(buildPlanArtifact(SAMPLE));
    expect(text).toContain("# Plan Mode");
    expect(text).toContain("1. [x] Read the failing test");
    expect(text).toContain("2. [~] Reproduce the bug locally <-");
    expect(text).toContain("3. [ ] Implement the fix");
  });

  it("renders an Annotations section when annotations are present", () => {
    const text = renderPlanArtifactText(buildPlanArtifact(SAMPLE));
    expect(text).toContain("## Annotations");
    expect(text).toContain("COMMENT on step-2: Add the --debug flag");
  });
});
