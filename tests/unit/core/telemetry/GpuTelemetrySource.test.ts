import { describe, it, expect, beforeEach } from "vitest";
import {
  GpuTelemetrySource,
  buildCpuFallbackSample,
  parseAppleSystemProfiler,
  parseNvidiaSmiCsv,
  type GpuQueryResult,
} from "../../../../core/telemetry/GpuTelemetrySource.js";
import {
  InProcessTelemetryBus,
  type TelemetryEvent,
} from "../../../../core/telemetry/TelemetryBus.js";

describe("parseNvidiaSmiCsv", () => {
  it("parses a typical nvidia-smi CSV line", () => {
    const text = `45, 12288, 8192, NVIDIA GeForce RTX 4070`;
    const res = parseNvidiaSmiCsv(text);
    expect(res).not.toBeNull();
    expect(res?.device).toBe("cuda");
    expect(res?.deviceName).toBe("NVIDIA GeForce RTX 4070");
    expect(res?.utilizationPct).toBe(45);
    expect(res?.totalVramGB).toBeCloseTo(12, 1);
    expect(res?.freeVramGB).toBeCloseTo(8, 1);
  });

  it("clamps utilization above 100", () => {
    const res = parseNvidiaSmiCsv("250, 12288, 8192, RTX");
    expect(res?.utilizationPct).toBe(100);
  });

  it("returns null on empty or malformed input", () => {
    expect(parseNvidiaSmiCsv("")).toBeNull();
    expect(parseNvidiaSmiCsv("garbage")).toBeNull();
    expect(parseNvidiaSmiCsv("a, b, c, d")).toBeNull();
  });

  it("skips a header row if present and parses the next line", () => {
    const text = `utilization.gpu, memory.total, memory.free, name
10, 8192, 4096, RTX 3080`;
    const res = parseNvidiaSmiCsv(text);
    expect(res?.deviceName).toBe("RTX 3080");
    expect(res?.totalVramGB).toBeCloseTo(8, 1);
  });

  it("handles CRLF line endings (Windows nvidia-smi)", () => {
    const text = "30, 16384, 12288, NVIDIA RTX 4080\r\n";
    const res = parseNvidiaSmiCsv(text);
    expect(res?.utilizationPct).toBe(30);
    expect(res?.deviceName).toBe("NVIDIA RTX 4080");
  });
});

describe("parseAppleSystemProfiler", () => {
  it("parses Apple Silicon JSON output with explicit VRAM", () => {
    const json = JSON.stringify({
      SPDisplaysDataType: [
        { sppci_model: "Apple M2 Pro", spdisplays_vram: "16 GB" },
      ],
    });
    const res = parseAppleSystemProfiler(json);
    expect(res?.device).toBe("apple");
    expect(res?.deviceName).toBe("Apple M2 Pro");
    expect(res?.totalVramGB).toBeCloseTo(16, 1);
  });

  it("parses MB-suffixed VRAM strings", () => {
    const json = JSON.stringify({
      SPDisplaysDataType: [{ sppci_model: "Apple M1", spdisplays_vram: "8192 MB" }],
    });
    const res = parseAppleSystemProfiler(json);
    expect(res?.totalVramGB).toBeCloseTo(8, 1);
  });

  it("falls back to provided RAM hint when VRAM string is missing", () => {
    const json = JSON.stringify({ SPDisplaysDataType: [{ sppci_model: "Apple M2" }] });
    const res = parseAppleSystemProfiler(json, 24);
    expect(res?.totalVramGB).toBeCloseTo(24, 1);
  });

  it("returns null on malformed JSON", () => {
    expect(parseAppleSystemProfiler("not-json")).toBeNull();
    expect(parseAppleSystemProfiler("")).toBeNull();
  });

  it("returns null when SPDisplaysDataType is empty", () => {
    const json = JSON.stringify({ SPDisplaysDataType: [] });
    expect(parseAppleSystemProfiler(json)).toBeNull();
  });
});

describe("buildCpuFallbackSample", () => {
  it("emits a coherent CPU-only fallback", () => {
    const s = buildCpuFallbackSample("Intel Xeon", 32, 16);
    expect(s.device).toBe("cpu");
    expect(s.utilizationPct).toBe(0);
    expect(s.totalVramGB).toBe(32);
    expect(s.freeVramGB).toBe(16);
  });
});

describe("GpuTelemetrySource", () => {
  let bus: InProcessTelemetryBus;
  let received: TelemetryEvent[];
  beforeEach(() => {
    bus = new InProcessTelemetryBus();
    received = [];
    bus.subscribe({ kinds: ["gpu.sample"] }, (e) => received.push(e));
  });

  it("publishes a single sample via sampleNow()", async () => {
    const src = new GpuTelemetrySource({
      telemetry: bus,
      query: () =>
        Promise.resolve<GpuQueryResult>({
          device: "cuda",
          deviceName: "RTX 4070",
          utilizationPct: 50,
          totalVramGB: 12,
          freeVramGB: 6,
        }),
    });
    const sample = await src.sampleNow();
    expect(sample).not.toBeNull();
    expect(sample?.device).toBe("cuda");
    expect(received).toHaveLength(1);
    expect((received[0]?.payload as { device: string }).device).toBe("cuda");
  });

  it("decorates samples with the active job info", async () => {
    const src = new GpuTelemetrySource({
      telemetry: bus,
      activeJobProvider: () => ({ modelId: "gemma4:e4b", queuedJobs: 3 }),
      query: () =>
        Promise.resolve<GpuQueryResult>({
          device: "cuda",
          deviceName: "RTX 4070",
          utilizationPct: 25,
          totalVramGB: 12,
          freeVramGB: 8,
        }),
    });
    const sample = await src.sampleNow();
    expect(sample?.activeModelId).toBe("gemma4:e4b");
    expect(sample?.queuedJobs).toBe(3);
  });

  it("falls back to CPU mode when the query rejects", async () => {
    const src = new GpuTelemetrySource({
      telemetry: bus,
      query: () => Promise.reject(new Error("nvidia-smi not found")),
    });
    const sample = await src.sampleNow();
    expect(sample?.device).toBe("cpu");
  });

  it("falls back to CPU mode when the query resolves to null", async () => {
    const src = new GpuTelemetrySource({
      telemetry: bus,
      query: () => Promise.resolve(null),
    });
    const sample = await src.sampleNow();
    expect(sample?.device).toBe("cpu");
  });

  it("start() polls on the supplied interval", async () => {
    const handlers: Array<() => void> = [];
    let cleared = false;
    const src = new GpuTelemetrySource({
      telemetry: bus,
      intervalMs: 100,
      query: () =>
        Promise.resolve<GpuQueryResult>({
          device: "cuda",
          deviceName: "RTX 4070",
          utilizationPct: 12,
          totalVramGB: 12,
          freeVramGB: 6,
        }),
      setInterval: (handler: () => void): unknown => {
        handlers.push(handler);
        return handlers.length;
      },
      clearInterval: (): void => {
        cleared = true;
      },
    });
    src.start();
    expect(handlers).toHaveLength(1);
    await Promise.resolve(); // let the immediate-fire settle
    handlers[0]?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(received.length).toBeGreaterThanOrEqual(1);
    src.stop();
    expect(cleared).toBe(true);
  });

  it("start() is idempotent", () => {
    let calls = 0;
    const src = new GpuTelemetrySource({
      telemetry: bus,
      intervalMs: 100,
      query: () => Promise.resolve<GpuQueryResult | null>(null),
      setInterval: (): unknown => {
        calls += 1;
        return calls;
      },
      clearInterval: (): void => undefined,
    });
    src.start();
    src.start();
    expect(calls).toBe(1);
  });

  it("stop() is safe before start()", () => {
    const src = new GpuTelemetrySource({
      telemetry: bus,
      query: () => Promise.resolve<GpuQueryResult | null>(null),
    });
    expect(() => src.stop()).not.toThrow();
  });

  it("clamps utilization between 0 and 100 in samples", async () => {
    const src = new GpuTelemetrySource({
      telemetry: bus,
      query: () =>
        Promise.resolve<GpuQueryResult>({
          device: "cuda",
          deviceName: "RTX",
          utilizationPct: 220,
          totalVramGB: 12,
          freeVramGB: 12,
        }),
    });
    const s = await src.sampleNow();
    expect(s?.utilizationPct).toBe(100);
  });

  it("lastSample reflects the most recent publish", async () => {
    const src = new GpuTelemetrySource({
      telemetry: bus,
      query: () =>
        Promise.resolve<GpuQueryResult>({
          device: "cuda",
          deviceName: "RTX",
          utilizationPct: 33,
          totalVramGB: 12,
          freeVramGB: 6,
        }),
    });
    expect(src.lastSample).toBeNull();
    await src.sampleNow();
    expect(src.lastSample?.utilizationPct).toBe(33);
  });

  it("default constructor with no query falls back to CPU sample", async () => {
    const src = new GpuTelemetrySource({ telemetry: bus });
    const sample = await src.sampleNow();
    expect(sample?.device).toBe("cpu");
  });

  // v1.5.0 Phase 1 (T003) -- optional energy fields.
  it("leaves energy fields undefined when no power sampler is wired", async () => {
    const src = new GpuTelemetrySource({
      telemetry: bus,
      query: () => Promise.resolve<GpuQueryResult>({
        device: "cuda",
        deviceName: "RTX",
        utilizationPct: 10,
        totalVramGB: 12,
        freeVramGB: 6,
      }),
    });
    const sample = await src.sampleNow();
    expect(sample?.powerDrawWatts).toBeUndefined();
    expect(sample?.energyStatus).toBeUndefined();
  });

  it("attaches powerDrawWatts + energyStatus=available when the power sampler returns watts", async () => {
    const src = new GpuTelemetrySource({
      telemetry: bus,
      query: () => Promise.resolve<GpuQueryResult>({
        device: "cuda",
        deviceName: "RTX",
        utilizationPct: 10,
        totalVramGB: 12,
        freeVramGB: 6,
      }),
      powerQuery: () => Promise.resolve(142.5),
    });
    const sample = await src.sampleNow();
    expect(sample?.powerDrawWatts).toBe(142.5);
    expect(sample?.energyStatus).toBe("available");
  });

  it("reports energyStatus=unavailable when the power sampler returns null or throws", async () => {
    const nullSrc = new GpuTelemetrySource({
      telemetry: bus,
      query: () => Promise.resolve<GpuQueryResult | null>(null),
      powerQuery: () => Promise.resolve(null),
    });
    const nullSample = await nullSrc.sampleNow();
    expect(nullSample?.powerDrawWatts).toBeNull();
    expect(nullSample?.energyStatus).toBe("unavailable");

    const throwSrc = new GpuTelemetrySource({
      telemetry: bus,
      query: () => Promise.resolve<GpuQueryResult | null>(null),
      powerQuery: () => Promise.reject(new Error("nvidia-smi power.draw unsupported")),
    });
    const throwSample = await throwSrc.sampleNow();
    expect(throwSample?.energyStatus).toBe("unavailable");
  });
});
