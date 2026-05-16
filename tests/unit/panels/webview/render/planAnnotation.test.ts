// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import {
  compilePlanAnnotations,
  PLAN_ANNOTATION_FN_SOURCE,
  type PlanAnnotation,
} from "../../../../../src/panels/webview/render/planAnnotation.js";

const renderPlanAnnotations = compilePlanAnnotations(document);

function annotation(overrides: Partial<PlanAnnotation> = {}): PlanAnnotation {
  return {
    id: "ann-1",
    blockId: "step-1",
    startOffset: 0,
    endOffset: 5,
    type: "COMMENT",
    text: "Add a verification step.",
    originalText: "Apply edits",
    ...overrides,
  };
}

describe("renderPlanAnnotations", () => {
  it("renders a DELETION as a struck span inside the deletions bucket", () => {
    const root = renderPlanAnnotations(
      [annotation({ type: "DELETION", originalText: "rm -rf /" })],
      { onRemove: () => {} },
    );
    const struck = root.querySelector(".plan-annotation-deletions .plan-annotation-struck");
    expect(struck).not.toBeNull();
    expect(struck?.textContent).toBe("rm -rf /");
    expect(
      root.querySelector(".plan-annotation-deletions .plan-annotation")
        ?.getAttribute("data-annotation-id"),
    ).toBe("ann-1");
  });

  it("renders a COMMENT in the sidebar with body text and a blockquote of the original span", () => {
    const root = renderPlanAnnotations(
      [
        annotation({
          type: "COMMENT",
          text: "Inline a check here.",
          originalText: "compile module",
        }),
      ],
      { onRemove: () => {} },
    );
    const callout = root.querySelector(".plan-annotation-sidebar .plan-annotation");
    expect(callout).not.toBeNull();
    expect(callout?.querySelector(".plan-annotation-text")?.textContent).toBe(
      "Inline a check here.",
    );
    expect(callout?.querySelector(".plan-annotation-quote")?.textContent).toBe(
      "compile module",
    );
  });

  it("renders a GLOBAL_COMMENT at the top of the plan annotation layer", () => {
    const root = renderPlanAnnotations(
      [
        annotation({
          type: "GLOBAL_COMMENT",
          text: "Touches the migration layer — add a backup checkpoint.",
          originalText: "",
        }),
      ],
      { onRemove: () => {} },
    );
    const callout = root.querySelector(".plan-annotation-globals .plan-annotation");
    expect(callout).not.toBeNull();
    expect(callout?.querySelector(".plan-annotation-text")?.textContent).toBe(
      "Touches the migration layer — add a backup checkpoint.",
    );
    expect(callout?.querySelector(".plan-annotation-quote")).toBeNull();
  });

  it("falls back to quickLabelTip when no explicit text is supplied", () => {
    const root = renderPlanAnnotations(
      [
        annotation({
          id: "ql-1",
          text: undefined,
          quickLabelTip: "This step extends beyond the agreed task boundary.",
        }),
      ],
      { onRemove: () => {} },
    );
    expect(root.querySelector(".plan-annotation-text")?.textContent).toBe(
      "This step extends beyond the agreed task boundary.",
    );
  });

  it("anchors each annotation via data attributes for the consumer to position", () => {
    const root = renderPlanAnnotations(
      [annotation({ blockId: "step-3", startOffset: 12, endOffset: 21 })],
      { onRemove: () => {} },
    );
    const node = root.querySelector(".plan-annotation");
    expect(node?.getAttribute("data-block-id")).toBe("step-3");
    expect(node?.getAttribute("data-anchor")).toBe("step-3:12-21");
  });

  it("invokes onRemove with the annotation id when the close button is clicked", () => {
    const onRemove = vi.fn();
    const root = renderPlanAnnotations(
      [annotation({ id: "del-me" })],
      { onRemove },
    );
    const btn = root.querySelector<HTMLButtonElement>(".plan-annotation-remove");
    btn?.click();
    expect(onRemove).toHaveBeenCalledWith("del-me");
  });

  it("renders multiple annotations sorted into their respective buckets", () => {
    const root = renderPlanAnnotations(
      [
        annotation({ id: "a", type: "GLOBAL_COMMENT", text: "Global hint" }),
        annotation({ id: "b", type: "COMMENT", text: "Inline hint" }),
        annotation({ id: "c", type: "DELETION", originalText: "stale step" }),
      ],
      { onRemove: () => {} },
    );
    expect(root.querySelectorAll(".plan-annotation-globals .plan-annotation"))
      .toHaveLength(1);
    expect(root.querySelectorAll(".plan-annotation-sidebar .plan-annotation"))
      .toHaveLength(1);
    expect(root.querySelectorAll(".plan-annotation-deletions .plan-annotation"))
      .toHaveLength(1);
  });

  it("never assigns user-supplied text to innerHTML", () => {
    expect(PLAN_ANNOTATION_FN_SOURCE.includes("innerHTML")).toBe(false);
  });
});
