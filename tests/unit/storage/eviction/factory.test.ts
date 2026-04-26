import { describe, expect, it } from "vitest";
import {
  ARCEvictor,
  ClockEvictor,
  createEvictor,
  isEvictionStrategy,
  LFUEvictor,
  LRUEvictor,
  WTinyLFUEvictor,
} from "../../../../src/storage/eviction/index.js";

describe("eviction factory", () => {
  it("returns the requested strategy", () => {
    expect(createEvictor("lru", 10)).toBeInstanceOf(LRUEvictor);
    expect(createEvictor("lfu", 10)).toBeInstanceOf(LFUEvictor);
    expect(createEvictor("arc", 10)).toBeInstanceOf(ARCEvictor);
    expect(createEvictor("wtinylfu", 10)).toBeInstanceOf(WTinyLFUEvictor);
    expect(createEvictor("clock", 10)).toBeInstanceOf(ClockEvictor);
  });

  it("falls back to LRU for an unknown strategy name", () => {
    expect(createEvictor("nonsense", 10)).toBeInstanceOf(LRUEvictor);
  });

  it("isEvictionStrategy validates known names", () => {
    expect(isEvictionStrategy("lru")).toBe(true);
    expect(isEvictionStrategy("arc")).toBe(true);
    expect(isEvictionStrategy("xxx")).toBe(false);
    expect(isEvictionStrategy(undefined)).toBe(false);
  });
});
