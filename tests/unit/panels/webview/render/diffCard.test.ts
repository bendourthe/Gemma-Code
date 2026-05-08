// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import {
  DIFF_CARD_FN_SOURCE,
  compileDiffCard,
} from "../../../../../src/panels/webview/render/diffCard.js";

const renderDiffCard = compileDiffCard(document);

describe("renderDiffCard", () => {
  it("renders a 5-line edit as 5 removed + 5 added lines", () => {
    const before = ["a", "b", "c", "d", "e"].join("\n");
    const after = ["A", "B", "C", "D", "E"].join("\n");

    const card = renderDiffCard(before, after, "src/foo.ts");

    expect(card.classList.contains("diff-card")).toBe(true);
    const removed = card.querySelectorAll(".diff-line.removed");
    const added = card.querySelectorAll(".diff-line.added");
    expect(removed).toHaveLength(5);
    expect(added).toHaveLength(5);
  });

  it("encodes the file path verbatim into the header", () => {
    const card = renderDiffCard("x", "y", "src/<dangerous>.ts");
    const path = card.querySelector(".diff-card-path");
    expect(path?.textContent).toBe("src/<dangerous>.ts");
  });

  it("emits an Added/Removed badge in the header", () => {
    const card = renderDiffCard("a\nb", "a\nb\nc", "x.ts");
    const badge = card.querySelector(".diff-card-badge");
    expect(badge?.textContent).toBe("Added 1 lines / Removed 0 lines");
  });

  it("wraps the diff body in a scrollable container", () => {
    const card = renderDiffCard("a", "b", "x.ts");
    const scroll = card.querySelector(".diff-card-scroll");
    expect(scroll).not.toBeNull();
  });

  it("never assigns user-supplied text to innerHTML", () => {
    // Sentinel: the function source must not contain `.innerHTML` at all so
    // user-supplied diff content cannot be parsed as HTML.
    expect(DIFF_CARD_FN_SOURCE.includes("innerHTML")).toBe(false);
  });

  it("preserves all 200 lines for a large edit (truncation handled by CSS scroll)", () => {
    const before = Array.from({ length: 200 }, (_, i) => `line-before-${i}`).join("\n");
    const after = Array.from({ length: 200 }, (_, i) => `line-after-${i}`).join("\n");
    const card = renderDiffCard(before, after, "huge.ts");
    const removed = card.querySelectorAll(".diff-line.removed");
    const added = card.querySelectorAll(".diff-line.added");
    expect(removed).toHaveLength(200);
    expect(added).toHaveLength(200);
  });
});
