// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import {
  compileThoughtMetaRow,
  THOUGHT_META_ROW_FN_SOURCE,
} from "../../../../../src/panels/webview/render/thoughtMetaRow.js";

const renderThoughtMetaRow = compileThoughtMetaRow(document);

describe("renderThoughtMetaRow", () => {
  it("renders Thinking... while the agent is in the thinking phase", () => {
    const row = renderThoughtMetaRow("thinking", null);
    expect(row.classList.contains("thought-meta-thinking")).toBe(true);
    expect(row.querySelector(".thought-meta-label")?.textContent).toBe("Thinking...");
  });

  it("flips to Thought for Ns when the phase completes", () => {
    const row = renderThoughtMetaRow("complete", 4_300);
    expect(row.classList.contains("thought-meta-complete")).toBe(true);
    expect(row.querySelector(".thought-meta-label")?.textContent).toBe("Thought for 4.3s");
  });

  it("treats null/negative duration as zero", () => {
    const a = renderThoughtMetaRow("complete", null);
    expect(a.querySelector(".thought-meta-label")?.textContent).toBe("Thought for 0s");
    const b = renderThoughtMetaRow("complete", -42);
    expect(b.querySelector(".thought-meta-label")?.textContent).toBe("Thought for 0s");
  });

  it("rounds to a single decimal of seconds", () => {
    const row = renderThoughtMetaRow("complete", 1234);
    expect(row.querySelector(".thought-meta-label")?.textContent).toBe("Thought for 1.2s");
  });

  it("never assigns user-supplied text to innerHTML", () => {
    expect(THOUGHT_META_ROW_FN_SOURCE.includes("innerHTML")).toBe(false);
  });
});
