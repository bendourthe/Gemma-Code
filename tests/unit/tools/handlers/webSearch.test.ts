import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WebSearchTool, FetchPageTool } from "../../../../src/tools/handlers/webSearch.js";

// ---------------------------------------------------------------------------
// Mock fetch globally
// ---------------------------------------------------------------------------

const mockFetch = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function params(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { _callId: "call_001", ...overrides };
}

function mockOkResponse(body: string): void {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    text: async () => body,
  } as unknown as Response);
}

function mockErrorResponse(status: number): void {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status,
    text: async () => "",
  } as unknown as Response);
}

// DuckDuckGo HTML structure (simplified)
const DUCKDUCKGO_HTML = `
<html><body>
  <div class="result">
    <a class="result__title">TypeScript Handbook</a>
    <a class="result__url">https://www.typescriptlang.org/docs/</a>
    <a class="result__snippet">The TypeScript Handbook is the official documentation.</a>
  </div>
  <div class="result">
    <a class="result__title">TypeScript on GitHub</a>
    <a class="result__url">https://github.com/microsoft/TypeScript</a>
    <a class="result__snippet">TypeScript is a language for application-scale JavaScript.</a>
  </div>
</body></html>`;

// ---------------------------------------------------------------------------
// WebSearchTool
// ---------------------------------------------------------------------------

describe("WebSearchTool", () => {
  it("returns parsed search results from DuckDuckGo HTML", async () => {
    mockOkResponse(DUCKDUCKGO_HTML);

    const tool = new WebSearchTool();
    const result = await tool.execute(params({ query: "TypeScript" }));

    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output);
    expect(parsed.results).toHaveLength(2);
    expect(parsed.results[0].title).toBe("TypeScript Handbook");
    expect(parsed.results[0].url).toBe("https://www.typescriptlang.org/docs/");
  });

  it("caps results at max_results when specified", async () => {
    mockOkResponse(DUCKDUCKGO_HTML);

    const tool = new WebSearchTool();
    const result = await tool.execute(params({ query: "TypeScript", max_results: 1 }));

    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output);
    expect(parsed.results).toHaveLength(1);
  });

  it("returns failure when fetch throws a network error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const tool = new WebSearchTool();
    const result = await tool.execute(params({ query: "TypeScript" }));

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/ECONNREFUSED/);
  });

  it("returns failure when DuckDuckGo returns non-200", async () => {
    mockErrorResponse(503);

    const tool = new WebSearchTool();
    const result = await tool.execute(params({ query: "TypeScript" }));

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/503/);
  });

  it("returns failure when query is missing", async () => {
    const tool = new WebSearchTool();
    const result = await tool.execute(params());
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/query/i);
  });

  it("returns empty results list when HTML has no result nodes", async () => {
    mockOkResponse("<html><body><p>No results.</p></body></html>");

    const tool = new WebSearchTool();
    const result = await tool.execute(params({ query: "xyzzy" }));

    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output);
    expect(parsed.results).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// FetchPageTool
// ---------------------------------------------------------------------------

describe("FetchPageTool", () => {
  it("strips HTML tags and returns plain text", async () => {
    mockOkResponse("<html><body><h1>Hello</h1><p>World</p></body></html>");

    const tool = new FetchPageTool();
    const result = await tool.execute(params({ url: "https://example.com" }));

    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output);
    expect(parsed.text).toContain("Hello");
    expect(parsed.text).toContain("World");
    expect(parsed.text).not.toContain("<h1>");
  });

  it("truncates output to 2000 characters with a suffix", async () => {
    const longHtml = "<p>" + "a".repeat(3000) + "</p>";
    mockOkResponse(longHtml);

    const tool = new FetchPageTool();
    const result = await tool.execute(params({ url: "https://example.com/long" }));

    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output);
    expect(parsed.truncated).toBe(true);
    expect(parsed.text.endsWith("... (truncated)")).toBe(true);
    expect(parsed.text.length).toBeLessThanOrEqual(2015); // 2000 chars + suffix
  });

  it("does not truncate content under 2000 characters", async () => {
    mockOkResponse("<p>Short content.</p>");

    const tool = new FetchPageTool();
    const result = await tool.execute(params({ url: "https://example.com" }));

    const parsed = JSON.parse(result.output);
    expect(parsed.truncated).toBe(false);
  });

  it("returns failure on HTTP error response", async () => {
    mockErrorResponse(404);

    const tool = new FetchPageTool();
    const result = await tool.execute(params({ url: "https://example.com/gone" }));

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/404/);
  });

  it("returns failure on network error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("timeout"));

    const tool = new FetchPageTool();
    const result = await tool.execute(params({ url: "https://slow.example.com" }));

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/timeout/i);
  });

  it("returns failure when url is missing", async () => {
    const tool = new FetchPageTool();
    const result = await tool.execute(params());
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/url/i);
  });
});
