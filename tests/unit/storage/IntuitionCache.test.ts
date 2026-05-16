import { describe, it, expect, vi } from "vitest";
import { IntuitionCache } from "../../../src/storage/IntuitionCache.js";
import type { MemoryEntry } from "../../../src/storage/MemoryShared.types.js";

function makeEntry(id: string): MemoryEntry {
  return {
    id,
    sessionId: null,
    content: `entry-${id}`,
    type: "fact",
    embedding: null,
    createdAt: 0,
    accessedAt: 0,
    accessCount: 0,
    relevanceDecay: 1,
    corroborationCount: 1,
  };
}

describe("IntuitionCache", () => {
  it("returns empty list and skips the ranker when disabled", async () => {
    const ranker = vi.fn(async () => [makeEntry("a")]);
    const cache = new IntuitionCache(ranker, { enabled: false });
    const result = await cache.prefetch({ currentFile: "/foo.ts" });
    expect(result).toEqual([]);
    expect(ranker).not.toHaveBeenCalled();
  });

  it("invokes the ranker once on miss and serves the cache on the second call", async () => {
    const ranker = vi.fn(async () => [makeEntry("a"), makeEntry("b")]);
    const cache = new IntuitionCache(ranker, { enabled: true });
    const first = await cache.prefetch({ currentFile: "/foo.ts" });
    const second = await cache.prefetch({ currentFile: "/foo.ts" });
    expect(ranker).toHaveBeenCalledOnce();
    expect(second).toEqual(first);
  });

  it("treats different signal tuples as distinct keys", async () => {
    const ranker = vi.fn(async ({ currentFile }) => [makeEntry(currentFile ?? "_")]);
    const cache = new IntuitionCache(ranker, { enabled: true });
    await cache.prefetch({ currentFile: "/a.ts" });
    await cache.prefetch({ currentFile: "/b.ts" });
    expect(ranker).toHaveBeenCalledTimes(2);
    expect(cache.size).toBe(2);
  });

  it("evicts cached rows once the warmth window expires", async () => {
    let now = 1_000_000;
    const ranker = vi.fn(async () => [makeEntry("a")]);
    const cache = new IntuitionCache(ranker, {
      enabled: true,
      warmthWindowMs: 100,
      now: () => now,
    });
    await cache.prefetch({ currentFile: "/foo.ts" });
    expect(cache.peek({ currentFile: "/foo.ts" })).not.toBeNull();
    now += 200;
    expect(cache.peek({ currentFile: "/foo.ts" })).toBeNull();
  });

  it("setEnabled(false) clears the cache", async () => {
    const ranker = vi.fn(async () => [makeEntry("a")]);
    const cache = new IntuitionCache(ranker, { enabled: true });
    await cache.prefetch({ currentFile: "/foo.ts" });
    expect(cache.size).toBe(1);
    cache.setEnabled(false);
    expect(cache.enabled).toBe(false);
    expect(cache.size).toBe(0);
  });

  it("enforces the maxEntries LRU cap", async () => {
    const ranker = vi.fn(async ({ currentFile }) => [makeEntry(currentFile ?? "")]);
    const cache = new IntuitionCache(ranker, { enabled: true, maxEntries: 2 });
    await cache.prefetch({ currentFile: "/a.ts" });
    await cache.prefetch({ currentFile: "/b.ts" });
    await cache.prefetch({ currentFile: "/c.ts" });
    expect(cache.size).toBe(2);
    // The oldest entry (/a.ts) should be evicted; /b.ts and /c.ts remain.
    expect(cache.peek({ currentFile: "/a.ts" })).toBeNull();
    expect(cache.peek({ currentFile: "/c.ts" })).not.toBeNull();
  });

  it("includes recentTools in the cache key", async () => {
    const ranker = vi.fn(async () => [makeEntry("a")]);
    const cache = new IntuitionCache(ranker, { enabled: true });
    await cache.prefetch({ currentFile: "/foo.ts", recentTools: ["read_file"] });
    await cache.prefetch({ currentFile: "/foo.ts", recentTools: ["write_file"] });
    expect(ranker).toHaveBeenCalledTimes(2);
  });
});
