import { describe, expect, it, beforeEach } from "vitest";
import {
  cachedCheck,
  cachedCheckSync,
  invalidateCheck,
  _checkCacheSizeForTests,
  DEFAULT_CHECK_TTL_MS,
} from "../../../src/tools/ToolActivationRules.js";

describe("cachedCheck", () => {
  beforeEach(() => {
    invalidateCheck();
  });

  it("returns the same value within the TTL window", async () => {
    let calls = 0;
    let now = 1_000_000;
    const probe = () => {
      calls++;
      return calls;
    };
    const a = await cachedCheck("docker", [], probe, { now: () => now });
    now += 1_000;
    const b = await cachedCheck("docker", [], probe, { now: () => now });
    expect(a).toBe(1);
    expect(b).toBe(1);
    expect(calls).toBe(1);
  });

  it("re-runs the probe after the TTL expires", async () => {
    let calls = 0;
    let now = 1_000_000;
    const probe = () => ++calls;
    await cachedCheck("docker", [], probe, { now: () => now });
    now += DEFAULT_CHECK_TTL_MS + 1;
    await cachedCheck("docker", [], probe, { now: () => now });
    expect(calls).toBe(2);
  });

  it("invalidate(name) drops only the matching entries", async () => {
    await cachedCheck("a", [], () => 1);
    await cachedCheck("b", [], () => 1);
    expect(_checkCacheSizeForTests()).toBe(2);
    invalidateCheck("a");
    expect(_checkCacheSizeForTests()).toBe(1);
  });

  it("invalidate() with no name clears everything", async () => {
    await cachedCheck("a", [], () => 1);
    await cachedCheck("b", [], () => 1);
    invalidateCheck();
    expect(_checkCacheSizeForTests()).toBe(0);
  });

  it("cachedCheckSync mirrors the async behaviour", () => {
    let calls = 0;
    let now = 1_000_000;
    const probe = () => ++calls;
    const a = cachedCheckSync("ollama", ["host"], probe, { now: () => now });
    now += 1_000;
    const b = cachedCheckSync("ollama", ["host"], probe, { now: () => now });
    expect(a).toBe(b);
    expect(calls).toBe(1);
    now += DEFAULT_CHECK_TTL_MS + 1;
    const c = cachedCheckSync("ollama", ["host"], probe, { now: () => now });
    expect(c).toBe(2);
  });
});
