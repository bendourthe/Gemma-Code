import { describe, it, expect, vi } from "vitest";
import {
  parseAgentToolCalls,
  stripAgentToolCalls,
  toolFormatForModel,
} from "../../../modules/coding/llm/parseAgentToolCalls.js";

describe("parseAgentToolCalls", () => {
  it("keeps Gemma XML parsing byte-identical for gemma4-xml", () => {
    const text =
      '<|tool_call>call:read_file{path:<|"|>src/extension.ts<|"|>}<tool_call|>';
    const parsed = parseAgentToolCalls(text, "gemma4-xml");
    expect(parsed.hasAny).toBe(true);
    expect(parsed.results).toHaveLength(1);
    expect(parsed.results[0]?.ok).toBe(true);
    if (parsed.results[0]?.ok) {
      expect(parsed.results[0].call.tool).toBe("read_file");
    }
  });

  it("parses llama3-json into AgentLoop ParseResult shape", () => {
    const text = JSON.stringify({
      name: "read_file",
      parameters: { path: "README.md" },
    });
    const parsed = parseAgentToolCalls(text, "llama3-json");
    expect(parsed.hasAny).toBe(true);
    expect(parsed.results[0]?.ok).toBe(true);
    if (parsed.results[0]?.ok) {
      expect(parsed.results[0].call.tool).toBe("read_file");
      expect(parsed.results[0].call.parameters.path).toBe("README.md");
    }
  });

  it("defaults unknown models to gemma4-xml", () => {
    expect(toolFormatForModel("not-a-real-model")).toBe("gemma4-xml");
  });

  it("strips llama3-json raw from the assistant text", () => {
    const text = '{"name":"read_file","parameters":{"path":"a.ts"}} leftover';
    const stripped = stripAgentToolCalls(text, "llama3-json");
    expect(stripped).not.toContain("read_file");
  });
});

describe("unloadOllamaModel", () => {
  it("posts keep_alive 0 to /api/generate", async () => {
    const { unloadOllamaModel } = await import(
      "../../../modules/coding/llm/ollamaUnload.js"
    );
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    const result = await unloadOllamaModel({
      model: "gemma4:e4b",
      baseUrl: "http://127.0.0.1:11434",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [, init] = fetchImpl.mock.calls[0]!;
    expect(JSON.parse(String((init as RequestInit).body))).toMatchObject({
      model: "gemma4:e4b",
      keep_alive: 0,
    });
  });
});
