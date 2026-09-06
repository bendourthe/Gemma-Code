import { describe, it, expect } from "vitest";
import {
  createTelemetryStream,
  type RawGpuSample,
} from "../src/lib/telemetryStream";
import type { LocalModelTelemetry } from "../src/components/LocalModelStatus.types";

function makeRaw(over: Partial<RawGpuSample> = {}): RawGpuSample {
  return {
    device: "cuda",
    deviceName: "RTX 4070",
    utilizationPct: 50,
    totalVramGB: 12,
    freeVramGB: 6,
    activeModelId: "gemma4:e4b",
    queuedJobs: 0,
    capturedAt: 1000,
    ...over,
  };
}

describe("createTelemetryStream", () => {
  it("renders idle when scheduler has no active job", () => {
    let push!: (s: RawGpuSample) => void;
    const stream = createTelemetryStream({
      source: (fn) => {
        push = fn;
        return () => undefined;
      },
      scheduler: () => ({ active: null, queued: [] }),
    });
    const seen: LocalModelTelemetry[] = [];
    const unsub = stream.subscribe((s) => seen.push(s));
    push(makeRaw());
    expect(seen).toHaveLength(1);
    expect(seen[0]?.idle).toBe(true);
    expect(seen[0]?.modelName).toBe("Idle");
    expect(seen[0]?.paramSize).toBe("");
    unsub();
  });

  it("decorates samples with scheduler queue snapshot", () => {
    let push!: (s: RawGpuSample) => void;
    const stream = createTelemetryStream({
      source: (fn) => {
        push = fn;
        return () => undefined;
      },
      scheduler: () => ({
        active: {
          id: "j1",
          moduleId: "coding",
          jobType: "tokens",
          modelId: "gemma4:e4b",
        },
        queued: [
          {
            id: "q1",
            moduleId: "image",
            jobType: "txt2img",
            estimatedVramGB: 6,
          },
          {
            id: "q2",
            moduleId: "video",
            jobType: "text2video",
            estimatedVramGB: 10,
          },
        ],
      }),
    });
    const seen: LocalModelTelemetry[] = [];
    const unsub = stream.subscribe((s) => seen.push(s));
    push(makeRaw({ utilizationPct: 75, freeVramGB: 4 }));
    expect(seen[0]?.queuedJobs?.length).toBe(2);
    expect(seen[0]?.idle).toBe(false);
    expect(seen[0]?.vramAllocatedGB).toBe(8);
    unsub();
  });

  it("uses the default resolver to extract a param size", () => {
    let push!: (s: RawGpuSample) => void;
    const stream = createTelemetryStream({
      source: (fn) => {
        push = fn;
        return () => undefined;
      },
      scheduler: () => ({
        active: {
          id: "j1",
          moduleId: "coding",
          jobType: "tokens",
          modelId: "llama-3-8b",
        },
        queued: [],
      }),
    });
    const seen: LocalModelTelemetry[] = [];
    const unsub = stream.subscribe((s) => seen.push(s));
    push(makeRaw({ activeModelId: "llama-3-8b" }));
    expect(seen[0]?.paramSize).toBe("8B");
    unsub();
  });

  it("invokes the supplied resolver when present", () => {
    let push!: (s: RawGpuSample) => void;
    const stream = createTelemetryStream({
      source: (fn) => {
        push = fn;
        return () => undefined;
      },
      resolver: {
        paramSize: () => "13B",
        displayName: () => "Custom Model",
      },
      scheduler: () => ({
        active: {
          id: "j1",
          moduleId: "coding",
          jobType: "tokens",
          modelId: "anything",
        },
        queued: [],
      }),
    });
    const seen: LocalModelTelemetry[] = [];
    const unsub = stream.subscribe((s) => seen.push(s));
    push(makeRaw({ activeModelId: "anything" }));
    expect(seen[0]?.modelName).toBe("Custom Model");
    expect(seen[0]?.paramSize).toBe("13B");
    unsub();
  });

  it("unsubscribes upstream when the last subscriber leaves", () => {
    let upstreamUnsubCalls = 0;
    const stream = createTelemetryStream({
      source: () => () => {
        upstreamUnsubCalls += 1;
      },
      scheduler: () => ({ active: null, queued: [] }),
    });
    const u1 = stream.subscribe(() => undefined);
    const u2 = stream.subscribe(() => undefined);
    u1();
    expect(upstreamUnsubCalls).toBe(0);
    u2();
    expect(upstreamUnsubCalls).toBe(1);
  });

  it("stop() detaches the upstream subscription", () => {
    let upstreamUnsubCalls = 0;
    const stream = createTelemetryStream({
      source: () => () => {
        upstreamUnsubCalls += 1;
      },
    });
    stream.subscribe(() => undefined);
    stream.stop();
    expect(upstreamUnsubCalls).toBe(1);
  });

  it("forwards energy telemetry fields when present (v1.5.0 Phase 1 T003)", () => {
    let push!: (s: RawGpuSample) => void;
    const stream = createTelemetryStream({
      source: (fn) => {
        push = fn;
        return () => undefined;
      },
      scheduler: () => ({
        active: {
          id: "j1",
          moduleId: "coding",
          jobType: "tokens",
          modelId: "gemma4:e4b",
        },
        queued: [],
      }),
    });
    const seen: LocalModelTelemetry[] = [];
    const unsub = stream.subscribe((s) => seen.push(s));
    push(
      makeRaw({
        powerDrawWatts: 142.5,
        tokensPerWatt: 12.3,
        joulesPerRequest: 285,
        energyStatus: "available",
      }),
    );
    expect(seen[0]?.powerDrawWatts).toBe(142.5);
    expect(seen[0]?.tokensPerWatt).toBe(12.3);
    expect(seen[0]?.joulesPerRequest).toBe(285);
    expect(seen[0]?.energyStatus).toBe("available");
    unsub();
  });

  it("forwards energyStatus=unavailable when the sensor is missing", () => {
    let push!: (s: RawGpuSample) => void;
    const stream = createTelemetryStream({
      source: (fn) => {
        push = fn;
        return () => undefined;
      },
    });
    const seen: LocalModelTelemetry[] = [];
    const unsub = stream.subscribe((s) => seen.push(s));
    push(makeRaw({ powerDrawWatts: null, energyStatus: "unavailable" }));
    expect(seen[0]?.energyStatus).toBe("unavailable");
    expect(seen[0]?.powerDrawWatts).toBeNull();
    unsub();
  });

  it("default scheduler returns idle / empty queue", () => {
    let push!: (s: RawGpuSample) => void;
    const stream = createTelemetryStream({
      source: (fn) => {
        push = fn;
        return () => undefined;
      },
    });
    const seen: LocalModelTelemetry[] = [];
    const unsub = stream.subscribe((s) => seen.push(s));
    push(makeRaw());
    expect(seen[0]?.idle).toBe(true);
    expect(seen[0]?.queuedJobs).toHaveLength(0);
    unsub();
  });

  it("is not idle at 0% utilization when a scheduler job is active", () => {
    let push!: (s: RawGpuSample) => void;
    const stream = createTelemetryStream({
      source: (fn) => {
        push = fn;
        return () => undefined;
      },
      scheduler: () => ({
        active: {
          id: "j1",
          moduleId: "chat",
          jobType: "tokens",
          modelId: "gemma4:e4b",
        },
        queued: [],
      }),
    });
    const seen: LocalModelTelemetry[] = [];
    const unsub = stream.subscribe((s) => seen.push(s));
    push(makeRaw({ utilizationPct: 0 }));
    expect(seen[0]?.idle).toBe(false);
    expect(seen[0]?.modelName).not.toBe("Idle");
    expect(seen[0]?.gpuPct).toBe(0);
    unsub();
  });
});
