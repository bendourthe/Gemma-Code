import { describe, it, expect } from "vitest";
import { getMemoryViewHtml } from "../../../../src/panels/webview/memoryView.js";

describe("memoryView (Models tab, v0.8.0 Phase 6.6)", () => {
  it("contains a Models tab button", () => {
    const html = getMemoryViewHtml("nonce-1", "vscode-resource:");
    expect(html).toContain('data-tab="models"');
    expect(html).toContain(">Models</button>");
  });

  it("includes the buildModelsTab handler that posts pin / unpin / unload", () => {
    const html = getMemoryViewHtml("nonce-1", "vscode-resource:");
    expect(html).toContain("buildModelsTab");
    expect(html).toContain("'modelPin'");
    expect(html).toContain("'modelUnpin'");
    expect(html).toContain("'modelUnload'");
  });

  it("renders a TTL since last load and a PINNED badge", () => {
    const html = getMemoryViewHtml("nonce-1", "vscode-resource:");
    expect(html).toContain("since last load");
    expect(html).toContain("[PINNED]");
  });
});
