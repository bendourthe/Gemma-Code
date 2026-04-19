import { describe, it, expect } from "vitest";
import { getWebviewHtml } from "../../../src/panels/webview/index.js";
import { getTraceDashboardHtml } from "../../../src/panels/webview/traceDashboard.js";

const REQUIRED_CSP_DIRECTIVES = [
  "default-src 'none'",
  "img-src 'none'",
  "connect-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "require-trusted-types-for 'script'",
];

describe("webview Content-Security-Policy", () => {
  it("chat webview includes all required CSP directives", () => {
    const html = getWebviewHtml("nonce123", "vscode-resource:", "gemma4:e4b");
    for (const directive of REQUIRED_CSP_DIRECTIVES) {
      expect(html).toContain(directive);
    }
  });

  it("trace-dashboard webview includes all required CSP directives", () => {
    const html = getTraceDashboardHtml("nonce456", "vscode-resource:");
    for (const directive of REQUIRED_CSP_DIRECTIVES) {
      expect(html).toContain(directive);
    }
  });

  it("chat webview does not permit unsafe-inline script", () => {
    const html = getWebviewHtml("nonce789", "vscode-resource:", "gemma4:e4b");
    expect(html).not.toMatch(/script-src[^;]*'unsafe-inline'/);
  });

  it("trace-dashboard webview does not permit unsafe-inline script", () => {
    const html = getTraceDashboardHtml("noncexyz", "vscode-resource:");
    expect(html).not.toMatch(/script-src[^;]*'unsafe-inline'/);
  });
});
