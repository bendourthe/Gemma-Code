import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { ToolOutputCache } from "../../../src/storage/ToolOutputCache.js";

/**
 * Phase 4 (v0.5.0) -- ToolOutputCache unit tests.
 *
 * Each test runs against an in-memory SQLite database and a freshly-created
 * tmpdir for the file fixtures the cache keys on. The tmpdir is removed in
 * afterEach so tests are fully isolated.
 */
describe("ToolOutputCache", () => {
  let cache: ToolOutputCache;
  let tmpdir: string;

  beforeEach(() => {
    cache = new ToolOutputCache({ capacity: 5 });
    cache.open(":memory:");
    tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), "tool-output-cache-test-"));
  });

  afterEach(() => {
    cache.close();
    try {
      fs.rmSync(tmpdir, { recursive: true, force: true });
    } catch {
      /* swallow */
    }
  });

  function writeFile(name: string, content: string): string {
    const p = path.join(tmpdir, name);
    fs.writeFileSync(p, content);
    return p;
  }

  // -------------------------------------------------------------------------

  it("returns null on first lookup of an unknown path", () => {
    const p = writeFile("a.txt", "hello");
    expect(cache.lookup(p)).toBeNull();
  });

  it("round-trips a stored entry across lookup as fresh content", () => {
    const p = writeFile("a.txt", "hello world");
    cache.store(p, "hello world");
    const result = cache.lookup(p);
    expect(result).not.toBeNull();
    expect(result!.content).toBe("hello world");
    expect(result!.fresh).toBe(true);
  });

  it("returns previous content with fresh=false when mtime changes", async () => {
    const p = writeFile("a.txt", "hello");
    cache.store(p, "hello");
    expect(cache.lookup(p)!.fresh).toBe(true);

    await new Promise((r) => setTimeout(r, 20));
    const future = new Date(Date.now() + 60_000);
    fs.utimesSync(p, future, future);

    const result = cache.lookup(p);
    expect(result).not.toBeNull();
    expect(result!.content).toBe("hello");
    expect(result!.fresh).toBe(false);
  });

  it("returns previous content with fresh=false when size changes", () => {
    const p = writeFile("a.txt", "hello");
    cache.store(p, "hello");
    expect(cache.lookup(p)!.fresh).toBe(true);

    const originalStat = fs.statSync(p);
    fs.writeFileSync(p, "hello!");
    fs.utimesSync(p, originalStat.atime, originalStat.mtime);

    const result = cache.lookup(p);
    expect(result).not.toBeNull();
    expect(result!.content).toBe("hello");
    expect(result!.fresh).toBe(false);
  });

  it("silently skips storing a path matching the secret-path denylist", () => {
    const p = writeFile(".env", "SECRET=1");
    cache.store(p, "SECRET=1", ".env");
    expect(cache.size()).toBe(0);
  });

  it("silently skips storing an id_rsa-style path", () => {
    const p = writeFile("id_rsa", "PRIVATE-KEY");
    cache.store(p, "PRIVATE-KEY", "id_rsa");
    expect(cache.size()).toBe(0);
  });

  it("evicts the least-recently-accessed entry when capacity is exceeded (LRU by accessed_at)", async () => {
    // Capacity is 5 from beforeEach.
    const paths: string[] = [];
    for (let i = 0; i < 5; i++) {
      const p = writeFile(`f${i}.txt`, `content-${i}`);
      paths.push(p);
      cache.store(p, `content-${i}`);
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(cache.size()).toBe(5);

    const p6 = writeFile("f5.txt", "content-5");
    cache.store(p6, "content-5");

    expect(cache.size()).toBe(5);
    expect(cache.lookup(paths[0]!)).toBeNull();
    const newest = cache.lookup(p6);
    expect(newest).not.toBeNull();
    expect(newest!.content).toBe("content-5");
  });

  it("preserves a hot row and evicts a cold row even when the cold row was stored later (true LRU)", async () => {
    // Stored order: hot, c1, c2, c3, c4 (capacity = 5). Without an accessed_at
    // bump, FIFO-by-stored_at would evict `hot` first. With the v0.6.0 LRU
    // ratchet, repeated lookups on `hot` push its accessed_at past every cold
    // row, so a 6th insert evicts the oldest *cold* row instead.
    const hot = writeFile("hot.txt", "hot-content");
    cache.store(hot, "hot-content");
    await new Promise((r) => setTimeout(r, 5));

    const cold: string[] = [];
    for (let i = 0; i < 4; i++) {
      const p = writeFile(`cold${i}.txt`, `cold-${i}`);
      cold.push(p);
      cache.store(p, `cold-${i}`);
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(cache.size()).toBe(5);

    // Bump `hot` accessed_at past every cold row.
    await new Promise((r) => setTimeout(r, 5));
    expect(cache.lookup(hot)!.fresh).toBe(true);

    // Force eviction of one row.
    const filler = writeFile("filler.txt", "filler-content");
    cache.store(filler, "filler-content");

    expect(cache.size()).toBe(5);
    // `hot` survives because its accessed_at is the most recent.
    const stillHot = cache.lookup(hot);
    expect(stillHot).not.toBeNull();
    expect(stillHot!.content).toBe("hot-content");
    // The oldest cold row (cold0) is evicted instead.
    expect(cache.lookup(cold[0]!)).toBeNull();
  });

  it("clear() removes all entries and returns the count removed", () => {
    const p = writeFile("a.txt", "hello");
    cache.store(p, "hello");
    expect(cache.size()).toBe(1);
    expect(cache.clear()).toBe(1);
    expect(cache.size()).toBe(0);
    expect(cache.lookup(p)).toBeNull();
  });

  it("prune() returns 0 when below capacity", () => {
    const p = writeFile("a.txt", "x");
    cache.store(p, "x");
    expect(cache.prune()).toBe(0);
  });

  it("stats() reports total entries and top-by-hits", () => {
    const a = writeFile("a.txt", "a");
    const b = writeFile("b.txt", "b");
    cache.store(a, "a");
    cache.store(b, "b");

    expect(cache.lookup(a)!.content).toBe("a");
    expect(cache.lookup(a)!.content).toBe("a");

    const stats = cache.stats();
    expect(stats.entries).toBe(2);
    expect(stats.topByHits.length).toBe(2);
    expect(stats.topByHits[0]!.absolutePath).toBe(a);
  });

  it("lruStats() exposes hits/misses and entries", () => {
    const a = writeFile("a.txt", "a");
    cache.store(a, "a");
    const before = cache.lruStats();

    expect(cache.lookup(a)!.content).toBe("a"); // LRU hit (store warmed it).

    const after = cache.lruStats();
    expect(after.hits).toBeGreaterThan(before.hits);
    expect(after.entries).toBeGreaterThanOrEqual(1);
    expect(after.bytes).toBeGreaterThanOrEqual(1);
  });

  it("lookup throws when the cache is not opened", () => {
    const closed = new ToolOutputCache();
    expect(() => closed.lookup("/tmp/x")).toThrow(/not open/i);
  });

  it("close()+open() round-trips a previously-stored entry on disk", () => {
    const dbPath = path.join(tmpdir, "cache.sqlite");
    const c1 = new ToolOutputCache({ capacity: 5 });
    c1.open(dbPath);

    const p = writeFile("a.txt", "persistent");
    c1.store(p, "persistent");
    c1.close();

    const c2 = new ToolOutputCache({ capacity: 5 });
    c2.open(dbPath);
    expect(c2.lookup(p)!.content).toBe("persistent");
    c2.close();
  });

  it("creates the .nexus subdir when given a workspace root", () => {
    const wsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ws-cache-"));
    const c = new ToolOutputCache();
    c.open(wsRoot);
    const expected = path.join(wsRoot, ".nexus", "tool-output-cache.sqlite");
    expect(c.dbPath()).toBe(expected);
    expect(fs.existsSync(expected)).toBe(true);
    c.close();
    fs.rmSync(wsRoot, { recursive: true, force: true });
  });
});
