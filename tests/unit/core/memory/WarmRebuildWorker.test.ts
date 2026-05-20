import { describe, it, expect } from "vitest";
import {
  warmRebuild,
  createWarmRebuildTask,
  type MemoryRow,
  type WarmRebuildSource,
} from "../../../../core/memory/WarmRebuildWorker.js";
import { Bm25Index } from "../../../../core/memory/Bm25Index.js";
import { DenseIndex } from "../../../../core/memory/DenseIndex.js";
import { LocalEmbedder } from "../../../../core/memory/LocalEmbedder.js";
import {
  InProcessHookBus,
  type LifecycleNotificationEvent,
} from "../../../../core/lifecycle/HookBus.js";

/**
 * v1.1.0 Phase 5.6 -- warm-build worker unit tests.
 *
 * Covers:
 *   - Fresh rebuild populates BM25 + Dense from the source
 *   - Fingerprint match short-circuits with skipped=true
 *   - Errors from loadAll bubble up after a notification
 *   - HookBus receives info / warning / error notifications
 *   - createWarmRebuildTask returns an IdleTimeScheduler-compatible shape
 */

function makeSource(rows: MemoryRow[], fingerprint = `r=${rows.length}`): WarmRebuildSource {
  return {
    async loadAll() {
      return rows;
    },
    async fingerprint() {
      return fingerprint;
    },
  };
}

describe("warmRebuild", () => {
  it("populates BM25 + Dense from the source", async () => {
    const rows: MemoryRow[] = [
      { entryId: "e1", text: "python pathlib resolve" },
      { entryId: "e2", text: "typescript array map" },
      { entryId: "e3", text: "rust ownership borrow" },
    ];
    const bm25 = new Bm25Index();
    const dense = new DenseIndex();
    const embedder = new LocalEmbedder({ forceFallback: true });
    const result = await warmRebuild(makeSource(rows), embedder, bm25, dense);
    expect(result.indexed).toBe(3);
    expect(result.skipped).toBe(false);
    expect(bm25.size).toBe(3);
    expect(dense.size).toBe(3);
    expect(result.fingerprint).toBe("r=3");
  });

  it("clears stale indexes before re-indexing", async () => {
    const bm25 = new Bm25Index();
    const dense = new DenseIndex();
    bm25.add("stale", "stale content");
    dense.add("stale", new Float32Array(384));
    const embedder = new LocalEmbedder({ forceFallback: true });
    await warmRebuild(
      makeSource([{ entryId: "fresh", text: "fresh content" }]),
      embedder,
      bm25,
      dense,
    );
    expect(bm25.entryIds()).toEqual(["fresh"]);
    expect(dense.allEntryIds()).toEqual(["fresh"]);
  });

  it("fingerprint match short-circuits without touching the indexes", async () => {
    const bm25 = new Bm25Index();
    const dense = new DenseIndex();
    bm25.add("preexisting", "preexisting content");
    const embedder = new LocalEmbedder({ forceFallback: true });
    const result = await warmRebuild(
      makeSource([{ entryId: "ignored", text: "ignored" }], "fp-1"),
      embedder,
      bm25,
      dense,
      { previousFingerprint: "fp-1" },
    );
    expect(result.skipped).toBe(true);
    expect(result.indexed).toBe(0);
    expect(bm25.entryIds()).toEqual(["preexisting"]);
  });

  it("HookBus receives info notifications on success", async () => {
    const bus = new InProcessHookBus(null);
    const events: LifecycleNotificationEvent[] = [];
    bus.on("lifecycle.notification", (e) => events.push(e));
    const bm25 = new Bm25Index();
    const dense = new DenseIndex();
    const embedder = new LocalEmbedder({ forceFallback: true });
    await warmRebuild(
      makeSource([{ entryId: "e1", text: "alpha beta" }]),
      embedder,
      bm25,
      dense,
      { hookBus: bus },
    );
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events[0]?.notificationKind).toBe("memory.warm-rebuild");
    expect(events.some((e) => e.severity === "info" && e.message.includes("complete"))).toBe(true);
  });

  it("loadAll failure emits an error notification and re-throws", async () => {
    const bus = new InProcessHookBus(null);
    const events: LifecycleNotificationEvent[] = [];
    bus.on("lifecycle.notification", (e) => events.push(e));
    const failing: WarmRebuildSource = {
      async loadAll() {
        throw new Error("disk read failed");
      },
    };
    await expect(
      warmRebuild(
        failing,
        new LocalEmbedder({ forceFallback: true }),
        new Bm25Index(),
        new DenseIndex(),
        { hookBus: bus },
      ),
    ).rejects.toThrow(/disk read failed/);
    expect(events.some((e) => e.severity === "error")).toBe(true);
  });

  it("embedBatch failure indexes BM25 anyway and emits a warning", async () => {
    const bus = new InProcessHookBus(null);
    const events: LifecycleNotificationEvent[] = [];
    bus.on("lifecycle.notification", (e) => events.push(e));
    const failingEmbedder = {
      dim: 384,
      backend: "hash-fallback" as const,
      async embed() {
        throw new Error("embedder dead");
      },
      async embedBatch() {
        throw new Error("embedder dead");
      },
    };
    const bm25 = new Bm25Index();
    const dense = new DenseIndex();
    const result = await warmRebuild(
      makeSource([{ entryId: "e1", text: "alpha" }]),
      failingEmbedder,
      bm25,
      dense,
      { hookBus: bus },
    );
    expect(result.indexed).toBe(1);
    expect(bm25.size).toBe(1);
    expect(dense.size).toBe(0);
    expect(events.some((e) => e.severity === "warning")).toBe(true);
  });

  it("0 rows: indexed=0, skipped=false, indexes empty", async () => {
    const bm25 = new Bm25Index();
    const dense = new DenseIndex();
    const result = await warmRebuild(
      makeSource([]),
      new LocalEmbedder({ forceFallback: true }),
      bm25,
      dense,
    );
    expect(result.indexed).toBe(0);
    expect(result.skipped).toBe(false);
    expect(bm25.size).toBe(0);
    expect(dense.size).toBe(0);
  });

  it("indexes 10,000 rows in well under the Phase 5.6 acceptance ceiling (60 s)", async () => {
    const rows: MemoryRow[] = [];
    for (let i = 0; i < 10_000; i++) {
      rows.push({ entryId: `e${i}`, text: `row ${i} alpha beta gamma` });
    }
    const start = Date.now();
    await warmRebuild(
      makeSource(rows),
      new LocalEmbedder({ forceFallback: true }),
      new Bm25Index(),
      new DenseIndex(),
    );
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(60_000);
  });
});

describe("createWarmRebuildTask", () => {
  it("returns an IdleTimeScheduler-compatible task", () => {
    const task = createWarmRebuildTask({
      source: makeSource([]),
      embedder: new LocalEmbedder({ forceFallback: true }),
      bm25: new Bm25Index(),
      dense: new DenseIndex(),
    });
    expect(task.id).toBe("memory.warm-rebuild");
    expect(typeof task.idleThresholdMs).toBe("number");
    expect(typeof task.cadenceMs).toBe("number");
    expect(typeof task.run).toBe("function");
  });

  it("updates fingerprintRef.current after each run", async () => {
    const ref = { current: null as string | null };
    const rows: MemoryRow[] = [{ entryId: "e1", text: "alpha" }];
    const task = createWarmRebuildTask({
      source: makeSource(rows, "fp-2"),
      embedder: new LocalEmbedder({ forceFallback: true }),
      bm25: new Bm25Index(),
      dense: new DenseIndex(),
      fingerprintRef: ref,
    });
    await task.run();
    expect(ref.current).toBe("fp-2");
    // second run with same fingerprint short-circuits
    await task.run();
    expect(ref.current).toBe("fp-2");
  });

  it("honours custom id / idleThresholdMs / cadenceMs", () => {
    const task = createWarmRebuildTask({
      id: "custom.id",
      source: makeSource([]),
      embedder: new LocalEmbedder({ forceFallback: true }),
      bm25: new Bm25Index(),
      dense: new DenseIndex(),
      idleThresholdMs: 1_000,
      cadenceMs: 5_000,
    });
    expect(task.id).toBe("custom.id");
    expect(task.idleThresholdMs).toBe(1_000);
    expect(task.cadenceMs).toBe(5_000);
  });
});
