import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Default DNS mock: a routable public IP. Specific tests override per-call.
const dnsLookup = vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]);

vi.mock("node:dns/promises", () => ({
  lookup: (...args: unknown[]) => dnsLookup(...(args as [])),
}));

import {
  WebResponseCache,
  DEFAULT_TTL_SECONDS,
} from "../../../../src/tools/handlers/webCache.js";

describe("WebResponseCache", () => {
  let cache: WebResponseCache;

  beforeEach(() => {
    cache = new WebResponseCache();
    cache.open(":memory:");
    dnsLookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  });

  afterEach(() => {
    cache.close();
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------

  it("returns null on first lookup of an unknown URL", async () => {
    expect(await cache.lookup("https://example.com/foo")).toBeNull();
  });

  it("round-trips a stored response", async () => {
    cache.store(
      "https://example.com/q?x=1",
      "<html>cached</html>",
      "text/html",
      60,
    );
    const hit = await cache.lookup("https://example.com/q?x=1");
    expect(hit).not.toBeNull();
    expect(hit!.response).toBe("<html>cached</html>");
    expect(hit!.contentType).toBe("text/html");
    expect(hit!.hits).toBe(1);
  });

  it("treats an expired TTL as a miss", async () => {
    cache.store("https://example.com/exp", "old", "text/plain", 0);
    expect(await cache.lookup("https://example.com/exp")).toBeNull();
    expect(cache.stats().expired).toBe(1);
  });

  it("uses the default TTL of 6 hours when none is supplied", async () => {
    cache.store("https://example.com/d", "x", "text/plain");
    const hit = await cache.lookup("https://example.com/d");
    expect(hit!.ttlSeconds).toBe(DEFAULT_TTL_SECONDS);
  });

  it("returns null when the live SSRF guard rejects the cached URL", async () => {
    cache.store("https://example.com/blocked", "x", "text/plain", 600);
    // After storage, simulate a guard rule change: DNS resolves to a private IP.
    dnsLookup.mockResolvedValueOnce([{ address: "10.0.0.1", family: 4 }]);
    expect(await cache.lookup("https://example.com/blocked")).toBeNull();
  });

  it("UPSERTs on subsequent stores for the same URL", async () => {
    cache.store("https://example.com/x", "v1", "text/plain", 60);
    cache.store("https://example.com/x", "v2", "text/plain", 60);
    const hit = await cache.lookup("https://example.com/x");
    expect(hit!.response).toBe("v2");
  });

  it("clear() removes all entries and returns the count removed", async () => {
    cache.store("https://example.com/a", "a", "text/plain", 60);
    cache.store("https://example.com/b", "b", "text/plain", 60);
    expect(cache.size()).toBe(2);
    expect(cache.clear()).toBe(2);
    expect(cache.size()).toBe(0);
  });

  it("stats() exposes hits and misses", async () => {
    cache.store("https://example.com/a", "a", "text/plain", 60);
    await cache.lookup("https://example.com/a"); // hit
    await cache.lookup("https://example.com/missing"); // miss
    const stats = cache.stats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
    expect(stats.entries).toBe(1);
  });

  it("lookup throws when the cache is not open", async () => {
    const closed = new WebResponseCache();
    await expect(closed.lookup("https://example.com/x")).rejects.toThrow(
      /not open/i,
    );
  });
});
