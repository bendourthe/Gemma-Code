import { describe, it, expect } from "vitest";

// Mock settings to use the OLLAMA_URL environment variable
vi.mock("../../src/config/settings.js", () => ({
  getSettings: () => ({
    ollamaUrl: process.env["OLLAMA_URL"] ?? "http://localhost:11434",
    modelName: "gemma3:27b",
    maxTokens: 8192,
    temperature: 0.2,
    requestTimeout: 30000,
  }),
}));

const { createOllamaClient } = await import("../../src/ollama/client.js");

const ollamaUrl = process.env["OLLAMA_URL"];

describe.skipIf(!ollamaUrl)("Ollama integration smoke tests", () => {
  it("checkHealth() returns true against a real Ollama server", async () => {
    const client = createOllamaClient(ollamaUrl);
    const healthy = await client.checkHealth();
    expect(healthy).toBe(true);
  });

  it("listModels() returns at least one gemma model", async () => {
    const client = createOllamaClient(ollamaUrl);
    const models = await client.listModels();

    expect(models.length).toBeGreaterThan(0);

    const hasGemmaModel = models.some((m) => /gemma/i.test(m.name));
    expect(hasGemmaModel).toBe(true);
  });
});
