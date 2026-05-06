import { describe, it, expect } from "vitest";
import { resolveModelContextLimit } from "../../../src/config/PromptBudget.js";

describe("resolveModelContextLimit", () => {
  it("returns the global default when no override is supplied", () => {
    expect(resolveModelContextLimit("gemma4:e4b", 131072, {})).toBe(131072);
  });

  it("uses an explicit maxTokens override", () => {
    const overrides = { "gemma4:31b": { maxTokens: 262144 } };
    expect(resolveModelContextLimit("gemma4:31b", 131072, overrides)).toBe(262144);
  });

  it("falls back to global when override is empty", () => {
    expect(resolveModelContextLimit("gemma4:e4b", 131072, { "gemma4:e4b": {} })).toBe(131072);
  });

  it("uses minContextLimit as a floor when maxTokens absent", () => {
    const overrides = { "gemma4:26b": { minContextLimit: 200000 } };
    expect(resolveModelContextLimit("gemma4:26b", 131072, overrides)).toBe(200000);
    // When global already exceeds the floor, the floor must not shrink it.
    expect(resolveModelContextLimit("gemma4:26b", 300000, overrides)).toBe(300000);
  });

  it("prefers maxTokens over minContextLimit", () => {
    const overrides = { "gemma4:26b": { maxTokens: 250000, minContextLimit: 100000 } };
    expect(resolveModelContextLimit("gemma4:26b", 131072, overrides)).toBe(250000);
  });

  it("ignores zero or negative override values", () => {
    expect(resolveModelContextLimit("gemma4:26b", 131072, { "gemma4:26b": { maxTokens: 0 } })).toBe(131072);
    expect(resolveModelContextLimit("gemma4:26b", 131072, { "gemma4:26b": { maxTokens: -1 } })).toBe(131072);
  });
});
