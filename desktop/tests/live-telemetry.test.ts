/**
 * v2.2.0 Phase 2 (2.4) -- real GPU telemetry replaces the mock stream.
 *
 * The mock reported a plausible "Gemma 4 7B Active / GPU 41%" on hosts with no
 * NVIDIA adapter and nothing loaded. These tests pin the two honest states the
 * mock could not express: unavailable, and stale.
 */

import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_STALE_AFTER_MS,
  createLiveTelemetryStream,
} from "../src/lib/liveTelemetry";
import type { RawGpuSample } from "../src/lib/telemetryStream";

function sample(partial: Partial<RawGpuSample> = {}): RawGpuSample {
  return {
    device: "cuda",
    deviceName: "NVIDIA GeForce RTX 3080",
    utilizationPct: 41,
    totalVramGB: 10,
    freeVramGB: 4.8,
    activeModelId: null,
    queuedJobs: 0,
    capturedAt: 1_000,
    ...partial,
  };
}

function idleScheduler() {
  return Promise.resolve({ active: null, queued: [] });
}

describe("createLiveTelemetryStream", () => {
  it("emits translated samples to subscribers", async () => {
    const stream = createLiveTelemetryStream({
      intervalMs: 10_000,
      fetchSample: async () => sample(),
      fetchScheduler: idleScheduler,
    });
    const seen: string[] = [];
    const unsub = stream.subscribe((s) => seen.push(s.deviceName));
    await vi.waitFor(() => expect(seen.length).toBeGreaterThan(0));
    expect(seen[0]).toBe("NVIDIA GeForce RTX 3080");
    expect(stream.isUnavailable()).toBe(false);
    unsub();
    stream.stop();
  });

  it("reports unavailable (and emits nothing) when no sample can be taken", async () => {
    const stream = createLiveTelemetryStream({
      intervalMs: 10_000,
      fetchSample: async () => null,
      fetchScheduler: idleScheduler,
    });
    const seen: unknown[] = [];
    const unsub = stream.subscribe((s) => seen.push(s));
    await new Promise((r) => setTimeout(r, 20));
    expect(seen).toEqual([]);
    expect(stream.isUnavailable()).toBe(true);
    unsub();
    stream.stop();
  });

  it("marks a sample stale once it ages past the threshold", async () => {
    let now = 10_000;
    const stream = createLiveTelemetryStream({
      intervalMs: 10_000,
      fetchSample: async () => sample(),
      fetchScheduler: idleScheduler,
      now: () => now,
    });
    const unsub = stream.subscribe(() => undefined);
    await vi.waitFor(() => expect(stream.isUnavailable()).toBe(false));
    expect(stream.isStale()).toBe(false);
    now += DEFAULT_STALE_AFTER_MS + 1;
    expect(stream.isStale()).toBe(true);
    unsub();
    stream.stop();
  });

  it("stops polling when the last subscriber leaves", async () => {
    const fetchSample = vi.fn(async () => sample());
    const stream = createLiveTelemetryStream({
      intervalMs: 5,
      fetchSample,
      fetchScheduler: idleScheduler,
    });
    const unsub = stream.subscribe(() => undefined);
    await vi.waitFor(() =>
      expect(fetchSample.mock.calls.length).toBeGreaterThan(0),
    );
    unsub();
    const after = fetchSample.mock.calls.length;
    await new Promise((r) => setTimeout(r, 30));
    // At most one in-flight poll may land after unsubscribe.
    expect(fetchSample.mock.calls.length).toBeLessThanOrEqual(after + 1);
    stream.stop();
  });

  it("is not idle while a scheduler job is active even at 0% GPU", async () => {
    const stream = createLiveTelemetryStream({
      intervalMs: 10_000,
      fetchSample: async () => sample({ utilizationPct: 0 }),
      fetchScheduler: async () => ({
        active: {
          id: "j1",
          moduleId: "chat",
          jobType: "tokens",
          modelId: "gemma4:e4b",
        },
        queued: [],
      }),
    });
    const seen: string[] = [];
    const unsub = stream.subscribe((s) =>
      seen.push(s.idle ? "Idle" : s.modelName),
    );
    await vi.waitFor(() => expect(seen.length).toBeGreaterThan(0));
    expect(seen[0]).not.toBe("Idle");
    unsub();
    stream.stop();
  });
});
