/**
 * Integration: PromptBuilder + ToolRegistry composition.
 *
 * Wires the two modules together with a mock tool handler to verify the
 * Gemma 4 native protocol: the built system prompt must include <|tool>
 * declarations, and round-tripping a tool call through the registry must
 * produce a well-formed ToolResult.
 *
 * Requires no external service. (Renamed from `full-pipeline.test.ts` in
 * Phase 5 so the e2e file can cover the actual AgentLoop pipeline.)
 */

import { describe, it, expect, vi } from "vitest";
import { PromptBuilder } from "../../modules/coding/chat/PromptBuilder.js";
import { TOOL_CATALOG } from "../../src/tools/ToolCatalog.js";
import { ToolRegistry } from "../../src/tools/ToolRegistry.js";
import type { PromptContext } from "../../modules/coding/chat/PromptBuilder.types.js";
import type { ToolHandler, ToolResult } from "../../src/tools/types.js";

// Minimal VS Code stub so transitive ConversationManager imports resolve.
vi.mock("vscode", () => ({
  EventEmitter: class {
    private readonly _listeners: Array<(data: unknown) => void> = [];
    readonly event = (listener: (data: unknown) => void) => {
      this._listeners.push(listener);
      return { dispose: () => {} };
    };
    fire(data: unknown): void {
      for (const l of this._listeners) l(data);
    }
    dispose(): void {
      this._listeners.length = 0;
    }
  },
}));

function makeContext(overrides?: Partial<PromptContext>): PromptContext {
  return {
    modelName: "gemma4:e4b",
    maxTokens: 131_072,
    planModeActive: false,
    thinkingMode: false,
    enabledTools: [...TOOL_CATALOG],
    promptStyle: "concise",
    systemPromptBudgetPercent: 10,
    ...overrides,
  };
}

function makeHandler(fn: (params: Record<string, unknown>) => string): ToolHandler {
  return {
    execute: async (parameters): Promise<ToolResult> => ({
      id: "tc-test",
      success: true,
      output: fn(parameters),
    }),
  };
}

describe("e2e: full agent pipeline (mocked)", () => {
  it("system prompt declares tools in Gemma 4 native format", () => {
    const builder = new PromptBuilder();
    const prompt = builder.buildSync(makeContext());
    expect(prompt).toContain("<|tool>");
    expect(prompt).toContain("<tool|>");
    expect(prompt).toContain("read_file");
    expect(prompt).toContain("write_file");
  });

  it("ToolRegistry returns a well-formed ToolResult for a registered handler", async () => {
    const registry = new ToolRegistry();
    registry.register(
      "read_file",
      makeHandler((p) => `File contents of ${String(p["path"])}`),
    );

    const result = await registry.execute({
      tool: "read_file",
      id: "tc-1",
      parameters: { path: "src/extension.ts" },
    });
    expect(result.success).toBe(true);
    expect(result.output).toContain("src/extension.ts");
  });

  it("ToolRegistry filters catalog by enabled state", () => {
    const registry = new ToolRegistry();
    const noop = makeHandler(() => "");
    registry.register("read_file", noop);
    registry.register("write_file", noop);
    registry.setEnabled("write_file", false);

    const enabled = registry.getEnabledToolMetadata([...TOOL_CATALOG]);
    const names = enabled.map((t) => t.name);
    expect(names).toContain("read_file");
    expect(names).not.toContain("write_file");
  });

  it("disabled tools are omitted from the generated prompt", () => {
    const registry = new ToolRegistry();
    const noop = makeHandler(() => "");
    for (const tool of TOOL_CATALOG) {
      registry.register(tool.name, noop);
    }
    registry.setEnabled("write_file", false);
    registry.setEnabled("run_terminal", false);

    const enabled = registry.getEnabledToolMetadata([...TOOL_CATALOG]);
    const builder = new PromptBuilder();
    const prompt = builder.buildSync(makeContext({ enabledTools: enabled }));

    expect(prompt).toContain("read_file");
    expect(prompt).not.toContain('"name": "write_file"');
    expect(prompt).not.toContain('"name": "run_terminal"');
  });

  it("execute returns an error ToolResult when no handler is registered for a built-in", async () => {
    const registry = new ToolRegistry();
    const result = await registry.execute({
      tool: "read_file",
      id: "tc-ghost",
      parameters: {},
    });
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});
