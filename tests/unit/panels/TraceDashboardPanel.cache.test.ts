import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { TraceStore } from "../../../src/observability/TraceStore.js";
import { MetricsCollector } from "../../../src/observability/MetricsCollector.js";
import { ToolOutputCache } from "../../../src/storage/ToolOutputCache.js";
import { WebResponseCache } from "../../../src/tools/handlers/webCache.js";
import { TraceDashboardPanel } from "../../../src/panels/TraceDashboardPanel.js";
import {
  resetCompressionStats,
  compressSync,
} from "../../../modules/coding/utils/Compressor.js";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// Mock DNS so the WebResponseCache SSRF re-validation accepts test URLs.
vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]),
}));

/**
 * Phase 9 (v0.5.0) -- The dashboard's cache-aware panels read from
 * MetricsCollector + ToolOutputCache + WebResponseCache + module-level
 * Compressor telemetry. This test exercises `buildCacheStatsPayload()` so
 * the rendering logic is verified without a live webview.
 */
describe("TraceDashboardPanel cache panels (Phase 9)", () => {
  let store: TraceStore;
  let collector: MetricsCollector;
  let toolCache: ToolOutputCache;
  let webCache: WebResponseCache;
  let tmpdir: string;

  beforeEach(() => {
    resetCompressionStats();
    store = new TraceStore(":memory:");
    collector = new MetricsCollector(store);
    toolCache = new ToolOutputCache({ capacity: 50 });
    toolCache.open(":memory:");
    webCache = new WebResponseCache();
    webCache.open(":memory:");
    tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), "trace-dashboard-cache-"));
  });

  afterEach(() => {
    store.close();
    toolCache.close();
    webCache.close();
    try {
      fs.rmSync(tmpdir, { recursive: true, force: true });
    } catch {
      /* swallow */
    }
  });

  function fakeUri(): unknown {
    return { fsPath: "/extension", toString: () => "file:///extension" };
  }

  it("includes compression savings, cache hit rate, and top files", async () => {
    // Seed compression telemetry: a single compressSync call updates the
    // module-level counters.
    compressSync("a".repeat(1024));

    // Seed tool-output cache: one stored file with a hit on lookup.
    const file = path.join(tmpdir, "a.txt");
    fs.writeFileSync(file, "hello");
    toolCache.store(file, "hello");
    expect(toolCache.lookup(file)!.fresh).toBe(true);

    // Seed web cache: one stored URL with a lookup hit.
    webCache.store("https://example.com/q", "{\"results\":[]}", "application/json", 600);
    expect(await webCache.lookup("https://example.com/q")).not.toBeNull();

    const panel = new TraceDashboardPanel(
      fakeUri() as never,
      store,
      collector,
      { toolOutputCache: toolCache, webResponseCache: webCache },
    );

    const payload = panel.buildCacheStatsPayload();
    expect(payload.type).toBe("cacheStats");
    expect(payload.compressionOriginalBytes).toBeGreaterThan(0);
    expect(payload.compressionCompressedBytes).toBeGreaterThan(0);
    expect(payload.compressionSavedBytes).toBe(
      payload.compressionOriginalBytes - payload.compressionCompressedBytes,
    );
    expect(payload.toolOutputCache.entries).toBeGreaterThanOrEqual(1);
    expect(payload.toolOutputCache.hits).toBeGreaterThan(0);
    expect(payload.toolOutputCache.topByHits.length).toBeGreaterThan(0);
    expect(payload.webResponseCache).not.toBeNull();
    expect(payload.webResponseCache!.hits).toBe(1);
  });

  it("returns a zeroed payload when no caches are wired", () => {
    const panel = new TraceDashboardPanel(
      fakeUri() as never,
      store,
      collector,
      { toolOutputCache: null, webResponseCache: null },
    );

    const payload = panel.buildCacheStatsPayload();
    expect(payload.toolOutputCache.entries).toBe(0);
    expect(payload.toolOutputCache.hits).toBe(0);
    expect(payload.toolOutputCache.topByHits).toEqual([]);
    expect(payload.webResponseCache).toBeNull();
  });
});
