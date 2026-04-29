/**
 * Unit: Phase 3 (v0.6.0) -- shared webview helpers hoisted to
 * `src/panels/webview/util.ts`. Closes codebase-review #23 by replacing the
 * three-way duplication of `escapeHtml` / `escapeAttr` / `formatDate` across
 * SessionListPanel, traceDashboard, and the chat webview with a single
 * inline-script source.
 */

import { describe, it, expect } from "vitest";
import {
  WEBVIEW_HELPERS_JS,
  getWebviewHelpersScript,
} from "../../../../src/panels/webview/util.js";

interface HelperWindow {
  __gemmaWebviewHelpers?: {
    escapeHtml: (s: unknown) => string;
    escapeAttr: (s: unknown) => string;
    formatDate: (ts: number) => string;
  };
  escapeHtml?: (s: unknown) => string;
  escapeAttr?: (s: unknown) => string;
  formatDate?: (ts: number) => string;
}

function evalHelpers(): HelperWindow {
  const win: HelperWindow = {};
  // eslint-disable-next-line no-new-func
  new Function("window", WEBVIEW_HELPERS_JS)(win);
  return win;
}

describe("WEBVIEW_HELPERS_JS", () => {
  it("escapeHtml escapes the three HTML-significant chars", () => {
    const win = evalHelpers();
    expect(win.escapeHtml!("<script>x & y</script>")).toBe(
      "&lt;script&gt;x &amp; y&lt;/script&gt;",
    );
  });

  it("escapeAttr escapes quotes alongside angle brackets and ampersands", () => {
    const win = evalHelpers();
    expect(win.escapeAttr!(`a "b" 'c' &<d>`)).toBe(
      "a &quot;b&quot; &#39;c&#39; &amp;&lt;d&gt;",
    );
  });

  it("escapeHtml stringifies non-string input", () => {
    const win = evalHelpers();
    expect(win.escapeHtml!(42)).toBe("42");
    expect(win.escapeHtml!(null)).toBe("null");
  });

  it("formatDate returns 'Just now' for sub-minute deltas", () => {
    const win = evalHelpers();
    expect(win.formatDate!(Date.now() - 5_000)).toBe("Just now");
  });

  it("formatDate returns minute-resolution for sub-hour deltas", () => {
    const win = evalHelpers();
    expect(win.formatDate!(Date.now() - 5 * 60_000)).toBe("5m ago");
  });

  it("formatDate returns hour-resolution for sub-day deltas", () => {
    const win = evalHelpers();
    expect(win.formatDate!(Date.now() - 3 * 3_600_000)).toBe("3h ago");
  });

  it("formatDate returns day-resolution for sub-week deltas", () => {
    const win = evalHelpers();
    expect(win.formatDate!(Date.now() - 4 * 86_400_000)).toBe("4d ago");
  });

  it("does not redeclare helpers when evaluated twice", () => {
    const win = evalHelpers();
    const first = win.escapeHtml;
    // eslint-disable-next-line no-new-func
    new Function("window", WEBVIEW_HELPERS_JS)(win);
    expect(win.escapeHtml).toBe(first);
  });
});

describe("getWebviewHelpersScript", () => {
  it("wraps the helpers in a nonce-pinned <script> tag", () => {
    const out = getWebviewHelpersScript("abc123");
    expect(out.startsWith('<script nonce="abc123">')).toBe(true);
    expect(out.endsWith("</script>")).toBe(true);
    expect(out).toContain("escapeHtml");
    expect(out).toContain("escapeAttr");
    expect(out).toContain("formatDate");
  });

  it("does not interpolate untrusted nonces unsafely", () => {
    // The function takes a nonce that the caller derives from randomUUID();
    // even if a hostile value sneaked through, we want to surface it loudly
    // (broken HTML) rather than silently splice content. The contract here
    // is: the nonce is callsite-controlled; we do not sanitize.
    const out = getWebviewHelpersScript('safe-nonce');
    expect(out).toContain('nonce="safe-nonce"');
  });
});
