import { describe, it, expect } from "vitest";
import {
  estimateEnergy,
  estimateEnergyForText,
  parseNvidiaPowerDraw,
  raplWattsFromEnergyDelta,
  samplePowerDraw,
  createPowerSampler,
  type PowerExec,
} from "../../../../core/telemetry/EnergyEstimator.js";

describe("estimateEnergy", () => {
  it("derives watts, tokens-per-watt, and joules-per-request from a sample", () => {
    const m = estimateEnergy({ powerWatts: 100, tokens: 1000, elapsedMs: 2000 });
    expect(m.status).toBe("available");
    expect(m.watts).toBe(100);
    expect(m.tokensPerWatt).toBe(10); // 1000 tokens / 100 W
    expect(m.joulesPerRequest).toBe(200); // 100 W * 2 s
  });

  it.each([null, undefined, 0, -5, Number.NaN, Number.POSITIVE_INFINITY] as Array<
    number | null | undefined
  >)("reports unavailable on a missing/invalid power sample (%s)", (power) => {
    const m = estimateEnergy({ powerWatts: power, tokens: 500, elapsedMs: 1000 });
    expect(m.status).toBe("unavailable");
    expect(m.watts).toBeNull();
    expect(m.tokensPerWatt).toBeNull();
    expect(m.joulesPerRequest).toBeNull();
  });

  it("treats a non-positive token count as zero tokens-per-watt", () => {
    const m = estimateEnergy({ powerWatts: 50, tokens: 0, elapsedMs: 1000 });
    expect(m.status).toBe("available");
    expect(m.tokensPerWatt).toBe(0);
  });
});

describe("estimateEnergyForText", () => {
  it("derives the token count via TokenCost.tokenize", () => {
    // "abcdefgh" is 8 UTF-8 bytes -> ceil(8/4) = 2 tokens.
    const m = estimateEnergyForText({ powerWatts: 4, text: "abcdefgh", elapsedMs: 1000 });
    expect(m.tokensPerWatt).toBe(0.5); // 2 tokens / 4 W
  });

  it("propagates the unavailable sentinel when power is missing", () => {
    const m = estimateEnergyForText({ powerWatts: null, text: "abc", elapsedMs: 100 });
    expect(m.status).toBe("unavailable");
  });
});

describe("parseNvidiaPowerDraw", () => {
  it("parses a watts reading", () => {
    expect(parseNvidiaPowerDraw("123.45\n")).toBe(123.45);
  });

  it("skips a header row and parses the value", () => {
    expect(parseNvidiaPowerDraw("power.draw [W]\n78.90")).toBe(78.9);
  });

  it("returns null on empty, zero, or malformed input", () => {
    expect(parseNvidiaPowerDraw("")).toBeNull();
    expect(parseNvidiaPowerDraw("0")).toBeNull();
    expect(parseNvidiaPowerDraw("garbage")).toBeNull();
  });
});

describe("raplWattsFromEnergyDelta", () => {
  it("averages watts from a microjoule counter delta", () => {
    // 10 J over 1 s = 10 W.
    expect(raplWattsFromEnergyDelta(0, 10_000_000, 1000)).toBe(10);
  });

  it("returns null on a wrapped counter or a non-positive interval", () => {
    expect(raplWattsFromEnergyDelta(10_000_000, 0, 1000)).toBeNull();
    expect(raplWattsFromEnergyDelta(0, 10_000_000, 0)).toBeNull();
  });
});

describe("samplePowerDraw", () => {
  const execReturning = (result: { code: number; stdout: string }): PowerExec =>
    async () => result;

  it("returns watts when nvidia-smi reports power.draw", async () => {
    expect(await samplePowerDraw({ exec: execReturning({ code: 0, stdout: "150.0" }) })).toBe(150);
  });

  it("returns null when the power query fails (sensor unavailable)", async () => {
    expect(await samplePowerDraw({ exec: execReturning({ code: 1, stdout: "" }) })).toBeNull();
    expect(await samplePowerDraw({ exec: execReturning({ code: 0, stdout: "\n" }) })).toBeNull();
  });

  it("createPowerSampler binds the options into a PowerSampleFn", async () => {
    const sampler = createPowerSampler({ exec: execReturning({ code: 0, stdout: "88.8" }) });
    expect(await sampler()).toBe(88.8);
  });
});
