import { describe, it, expect } from "vitest";
import { skipIfNoOllama } from "../helpers/factories.js";

// Mock settings to use the OLLAMA_URL environment variable
vi.mock("../../modules/coding/config/settings.js", () => ({
  getSettings: () => ({
    ollamaUrl: process.env["OLLAMA_URL"] ?? "http://localhost:11434",
    modelName: "gemma4",
    maxTokens: 32768,
    temperature: 0.2,
    requestTimeout: 30000,
  }),
}));

const { createOllamaClient } = await import("../../modules/coding/llm/OllamaClient.js");

// Class: missing_env (see docs/archive/v0/v0.5/test-pyramid.md). Skip the suite when
// OLLAMA_URL is not configured; do not silently early-return inside the test body.
describe.skipIf(skipIfNoOllama())("Ollama integration smoke tests", () => {
  const ollamaUrl = process.env["OLLAMA_URL"];

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
