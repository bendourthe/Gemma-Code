import { describe, it, expect } from "vitest";
import {
  InMemoryModelRegistry,
  DEFAULT_CONTEXT_WINDOW,
  type ModelRecord,
} from "../../../../core/registry/ModelRegistry.js";

const WITH_WINDOW: ModelRecord = {
  id: "gemma4:e4b",
  displayName: "Gemma 4 E4B",
  family: "gemma",
  runtime: "ollama",
  contextWindow: 128_000,
};
const NO_WINDOW: ModelRecord = {
  id: "mystery:latest",
  displayName: "Mystery",
  family: "other",
  runtime: "ollama",
};

describe("ModelRegistry contextWindow", () => {
  it("normalises an absent contextWindow to DEFAULT_CONTEXT_WINDOW on store", () => {
    const registry = new InMemoryModelRegistry([NO_WINDOW]);
    expect(registry.metadata("mystery:latest").contextWindow).toBe(
      DEFAULT_CONTEXT_WINDOW,
    );
  });

  it("preserves an explicit per-model contextWindow", () => {
    const registry = new InMemoryModelRegistry([WITH_WINDOW]);
    expect(registry.metadata("gemma4:e4b").contextWindow).toBe(128_000);
  });

  it("seeds the default registry's gemma4:e4b with a 128K window", () => {
    const registry = new InMemoryModelRegistry();
    expect(registry.metadata("gemma4:e4b").contextWindow).toBe(128_000);
  });

  it("DEFAULT_CONTEXT_WINDOW matches skill-cleaner's 272K fallback", () => {
    expect(DEFAULT_CONTEXT_WINDOW).toBe(272_000);
  });
});

describe("getActiveContextWindow", () => {
  it("returns the default when no model is active", () => {
    const registry = new InMemoryModelRegistry([WITH_WINDOW]);
    expect(registry.getActiveContextWindow()).toBe(DEFAULT_CONTEXT_WINDOW);
  });

  it("returns the active model's contextWindow once selected", () => {
    const registry = new InMemoryModelRegistry([WITH_WINDOW]);
    registry.setActiveModel("gemma4:e4b");
    expect(registry.getActiveContextWindow()).toBe(128_000);
  });

  it("falls back to the default when the active id is unknown", () => {
    const registry = new InMemoryModelRegistry([WITH_WINDOW]);
    registry.setActiveModel("does-not-exist");
    expect(registry.getActiveContextWindow()).toBe(DEFAULT_CONTEXT_WINDOW);
  });

  it("falls back to the default after the active model is cleared", () => {
    const registry = new InMemoryModelRegistry([WITH_WINDOW]);
    registry.setActiveModel("gemma4:e4b");
    registry.setActiveModel(null);
    expect(registry.getActiveContextWindow()).toBe(DEFAULT_CONTEXT_WINDOW);
  });

  it("clears the active selection when the active model is removed", async () => {
    const registry = new InMemoryModelRegistry([WITH_WINDOW]);
    registry.setActiveModel("gemma4:e4b");
    await registry.remove("gemma4:e4b");
    expect(registry.getActiveContextWindow()).toBe(DEFAULT_CONTEXT_WINDOW);
  });
});
