import { describe, it, expect, beforeEach } from "vitest";
import {
  InProcessTelemetryBus,
  type TelemetryEvent,
} from "../../../../core/telemetry/TelemetryBus.js";

describe("InProcessTelemetryBus", () => {
  let bus: InProcessTelemetryBus;
  beforeEach(() => {
    bus = new InProcessTelemetryBus();
  });

  it("delivers a published event to a matching subscriber", () => {
    const received: TelemetryEvent[] = [];
    bus.subscribe({ kinds: ["gpu.sample"] }, (e) => received.push(e));
    bus.publish({ kind: "gpu.sample", source: "nvidia-smi", payload: { gpuPct: 42 } });
    expect(received).toHaveLength(1);
    expect(received[0]?.kind).toBe("gpu.sample");
    expect(received[0]?.payload).toEqual({ gpuPct: 42 });
    expect(received[0]?.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("filters by kind", () => {
    const received: TelemetryEvent[] = [];
    bus.subscribe({ kinds: ["gpu.sample"] }, (e) => received.push(e));
    bus.publish({ kind: "vram.sample", source: "nvidia-smi" });
    bus.publish({ kind: "gpu.sample", source: "nvidia-smi" });
    expect(received).toHaveLength(1);
    expect(received[0]?.kind).toBe("gpu.sample");
  });

  it("filters by source", () => {
    const received: TelemetryEvent[] = [];
    bus.subscribe({ source: "coding" }, (e) => received.push(e));
    bus.publish({ kind: "module.activated", source: "coding" });
    bus.publish({ kind: "module.activated", source: "image" });
    expect(received).toHaveLength(1);
    expect(received[0]?.source).toBe("coding");
  });

  it("an empty filter matches everything", () => {
    const received: TelemetryEvent[] = [];
    bus.subscribe({}, (e) => received.push(e));
    bus.publish({ kind: "job.queued", source: "coding" });
    bus.publish({ kind: "module.activated", source: "image" });
    expect(received).toHaveLength(2);
  });

  it("dispose() stops further delivery", () => {
    const received: TelemetryEvent[] = [];
    const sub = bus.subscribe({}, (e) => received.push(e));
    bus.publish({ kind: "job.queued", source: "coding" });
    sub.dispose();
    bus.publish({ kind: "job.queued", source: "coding" });
    expect(received).toHaveLength(1);
    expect(bus.subscriberCount).toBe(0);
  });

  it("a throwing handler does not poison other subscribers", () => {
    const good: TelemetryEvent[] = [];
    bus.subscribe({}, () => {
      throw new Error("boom");
    });
    bus.subscribe({}, (e) => good.push(e));
    bus.publish({ kind: "job.queued", source: "coding" });
    expect(good).toHaveLength(1);
  });

  it("publish() stamps an ISO timestamp", () => {
    const received: TelemetryEvent[] = [];
    bus.subscribe({}, (e) => received.push(e));
    bus.publish({ kind: "model.load.start", source: "coding" });
    expect(received[0]?.ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});
