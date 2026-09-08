/**
 * v2.2.0 Phase 8 (DF-9/10/11) -- Video Lab honours the single-GPU policy.
 *
 * Image Studio has gated generation on the switch policy since Phase 4; Video
 * Lab still loaded unconditionally. Video is the tab most likely to collide
 * with agentic work, which is the case the policy exists for.
 */

import { readFileSync } from "node:fs";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(
  path.resolve(__dirname, "../src/modules/video/VideoLabPage.tsx"),
  "utf8",
);

describe("Video Lab switch policy", () => {
  it("classifies on submit", () => {
    expect(SOURCE).toContain("residency.request({");
    expect(SOURCE).toContain('requestingModule: "video"');
  });

  it("never classifies on mount", () => {
    // A stray click on this tab while an agentic job is running must not
    // evict anything. Only `handleSubmit` may ask the policy.
    const submitAt = SOURCE.indexOf("const handleSubmit");
    const requestAt = SOURCE.indexOf("residency.request({");
    expect(submitAt).toBeGreaterThan(0);
    expect(requestAt).toBeGreaterThan(submitAt);
    // And there is exactly one classification site.
    expect(SOURCE.split("residency.request({").length - 1).toBe(1);
  });

  it("returns without generating when the policy asks for confirmation", () => {
    // v2.4.8 follow-up: a busy-GPU answer already given carries through the
    // confirm verdict, so the condition also checks `busyApproved`.
    expect(SOURCE).toContain('if (verdict.kind === "confirm" && !busyApproved)');
    expect(SOURCE).toContain("pendingPromptRef.current = { text, attachments }");
  });

  it("resumes the same prompt after the user agrees", () => {
    // Losing the prompt on confirm would make the dialog feel like a failure.
    expect(SOURCE).toContain("const resumed = pendingPromptRef.current");
    expect(SOURCE).toContain("void handleSubmit(resumed.text, resumed.attachments, true)");
  });

  it("explains a refusal instead of failing silently", () => {
    expect(SOURCE).toContain('verdict.kind === "not-installed"');
    expect(SOURCE).toContain("Cannot load");
  });

  it("defaults unknown VRAM to null rather than guessing a fit", () => {
    // The policy treats null as "ask the user"; a guessed number would let it
    // silently co-resident two models that do not fit.
    expect(SOURCE).toContain("hostVramFreeGB = null");
  });

  it("renders the dialog and the switching chip", () => {
    expect(SOURCE).toContain("<ModelSwitchDialog");
    expect(SOURCE).toContain("<ModelSwitchChip");
  });
});
