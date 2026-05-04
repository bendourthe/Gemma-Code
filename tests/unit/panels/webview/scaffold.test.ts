import { describe, it, expect } from "vitest";
import {
  getChatWebviewHtml,
  formatModelName,
} from "../../../../src/panels/webview/scaffold.js";

describe("formatModelName", () => {
  it("splits trailing digits into a separate token", () => {
    expect(formatModelName("gemma4")).toBe("Gemma 4");
  });

  it("upper-cases the variant after the colon", () => {
    expect(formatModelName("gemma4:e4b")).toBe("Gemma 4 E4B");
  });

  it("preserves a numeric variant", () => {
    expect(formatModelName("gemma4:26b")).toBe("Gemma 4 26B");
  });

  it("falls back to the raw name when there is no digit", () => {
    expect(formatModelName("custom")).toBe("Custom");
  });
});

describe("getChatWebviewHtml", () => {
  it("inlines the per-render nonce in the style and script tags", () => {
    const html = getChatWebviewHtml("abc123", "vscode-resource:", "gemma4:e4b");
    expect(html).toContain('<style nonce="abc123">');
    expect(html).toContain('<script nonce="abc123">');
  });

  it("inlines the CSP source token", () => {
    const html = getChatWebviewHtml("nonce", "https://csp", "gemma4:e4b");
    expect(html).toContain("style-src https://csp 'nonce-nonce'");
  });

  it("renders the model display name in the footer", () => {
    const html = getChatWebviewHtml("nonce", "vscode-resource:", "gemma4:e4b");
    expect(html).toContain("Gemma 4 E4B");
  });

  it("starts with the strict doctype", () => {
    const html = getChatWebviewHtml("nonce", "vscode-resource:", "gemma4");
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
  });

  it("includes the runtime script and the body scaffold", () => {
    const html = getChatWebviewHtml("nonce", "vscode-resource:", "gemma4");
    expect(html).toContain("acquireVsCodeApi");
    expect(html).toContain('id="messages"');
    expect(html).toContain('id="input"');
  });
});
