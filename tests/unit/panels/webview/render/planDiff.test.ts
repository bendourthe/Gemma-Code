// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  compilePlanDiff,
  PLAN_DIFF_FN_SOURCE,
  type PlanDiffPayload,
} from "../../../../../src/panels/webview/render/planDiff.js";

const renderPlanDiff = compilePlanDiff(document);

const PAYLOAD: PlanDiffPayload = {
  planSlug: "auth",
  fromVersion: 1,
  toVersion: 2,
  clean: "1. Read file\n2. Apply edits\n**3. Run tests**",
  classic: " 1. Read file\n 2. Apply edits\n+3. Run tests",
  raw: "--- auth.md v1\n+++ auth.md v2\n@@ ...\n+3. Run tests",
};

describe("renderPlanDiff", () => {
  it("emits a header carrying the slug and the version range", () => {
    const root = renderPlanDiff(PAYLOAD, "classic", {});
    expect(root.querySelector(".plan-diff-title")?.textContent).toBe(
      "auth: v1 -> v2",
    );
  });

  it("renders three mode buttons and marks the active mode with an active class", () => {
    const root = renderPlanDiff(PAYLOAD, "classic", {});
    const btns = root.querySelectorAll<HTMLButtonElement>(".plan-diff-mode-btn");
    expect(btns).toHaveLength(3);
    const active = root.querySelector(".plan-diff-mode-active");
    expect(active?.getAttribute("data-mode")).toBe("classic");
  });

  it("classic mode emits one row per line tagged with add/del/context classes", () => {
    const root = renderPlanDiff(PAYLOAD, "classic", {});
    const lines = root.querySelectorAll(".plan-diff-line");
    expect(lines).toHaveLength(3);
    expect(lines[0]?.classList.contains("plan-diff-line-ctx")).toBe(true);
    expect(lines[2]?.classList.contains("plan-diff-line-add")).toBe(true);
  });

  it("raw mode emits a preformatted block carrying the unified diff text", () => {
    const root = renderPlanDiff(PAYLOAD, "raw", {});
    const pre = root.querySelector<HTMLElement>(".plan-diff-raw");
    expect(pre?.tagName).toBe("PRE");
    expect(pre?.textContent).toContain("+3. Run tests");
  });

  it("clean mode emits a single block carrying the inline-diff markdown text", () => {
    const root = renderPlanDiff(PAYLOAD, "clean", {});
    const block = root.querySelector(".plan-diff-clean");
    expect(block?.textContent).toContain("**3. Run tests**");
  });

  it("invokes onModeChange with the clicked mode", () => {
    const onModeChange = vi.fn();
    const root = renderPlanDiff(PAYLOAD, "classic", { onModeChange });
    const rawBtn = root.querySelector<HTMLButtonElement>(".plan-diff-mode-raw");
    rawBtn?.click();
    expect(onModeChange).toHaveBeenCalledWith("raw");
  });

  it("never assigns user-supplied text to innerHTML", () => {
    expect(PLAN_DIFF_FN_SOURCE.includes("innerHTML")).toBe(false);
  });
});
