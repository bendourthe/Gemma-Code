/**
 * Integration: Phase 9 (v0.5.0) -- API-response cache fronts `web_search`.
 *
 * Asserts that two consecutive `web_search` calls for the same query result
 * in exactly one network round-trip when a `WebResponseCache` is wired in.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock DNS so the SSRF guard accepts the upstream URL.
vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]),
}));

import { WebSearchTool } from "../../src/tools/handlers/webSearch.js";
import { WebResponseCache } from "../../src/tools/handlers/webCache.js";
import { mockOf } from "../helpers/factories.js";

const DUCKDUCKGO_HTML = `
<html><body>
  <div class="result">
    <a class="result__title">Example One</a>
    <a class="result__url">https://example.com/one</a>
    <a class="result__snippet">First snippet.</a>
  </div>
  <div class="result">
    <a class="result__title">Example Two</a>
    <a class="result__url">https://example.com/two</a>
    <a class="result__snippet">Second snippet.</a>
  </div>
</body></html>`;

const mockFetch = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
  mockFetch.mockResolvedValue(
    mockOf<Response>({
      ok: true,
      status: 200,
      text: async () => DUCKDUCKGO_HTML,
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("web_search response cache (integration)", () => {
  it("issues exactly one network request for two identical queries", async () => {
    const cache = new WebResponseCache();
    cache.open(":memory:");

    try {
      const tool = new WebSearchTool(cache);

      const first = await tool.execute({
        _callId: "c1",
        query: "TypeScript",
      });
      const second = await tool.execute({
        _callId: "c2",
        query: "TypeScript",
      });

      expect(first.success).toBe(true);
      expect(second.success).toBe(true);
      // Both responses are identical (cached output is byte-equal).
      expect(second.output).toBe(first.output);

      // Critical assertion: only one upstream call.
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // And the cache observed a hit on the second lookup.
      const stats = cache.stats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
    } finally {
      cache.close();
    }
  });

  it("issues two network requests for two distinct queries", async () => {
    const cache = new WebResponseCache();
    cache.open(":memory:");
    try {
      const tool = new WebSearchTool(cache);
      await tool.execute({ _callId: "c1", query: "TypeScript" });
      await tool.execute({ _callId: "c2", query: "Rust" });
      expect(mockFetch).toHaveBeenCalledTimes(2);
    } finally {
      cache.close();
    }
  });
});
