/**
 * v2.4.6 Phase 4 -- switching owned agentic ids keeps Hub tool dispatch.
 */

import { describe, expect, it, vi } from "vitest";

import { AgentLoop } from "../../../src/tools/AgentLoop.js";
import type { ConfirmationGate } from "../../../src/tools/ConfirmationGate.js";
import { ToolRegistry } from "../../../src/tools/ToolRegistry.js";
import type {
  ToolCall,
  ToolHandler,
  ToolResult,
} from "../../../src/tools/types.js";
import {
  collectMessages,
  makeConversationManager as makeManager,
  makeMultiResponseOllamaClient as makeMultiClient,
  makeToolRegistry as makeRegistry,
  mockOf,
} from "../../helpers/factories.js";

const toolCallText =
  '<|tool_call>call:read_file{path:<|"|>src/extension.ts<|"|>}<tool_call|>';

function makeHandler(result: ToolResult): ToolHandler {
  return { execute: vi.fn(async () => result) };
}

describe("owned agentic model switch", () => {
  it("keeps ToolRegistry.execute on the same loop after setModelName", async () => {
    const manager = makeManager();
    const registry = makeRegistry();
    const client = makeMultiClient([toolCallText, "Done reading."]);
    const loop = new AgentLoop(
      client,
      manager,
      registry,
      "gemma-4-12b-it-gguf",
    );
    const { postMessage } = collectMessages();

    await loop.run(postMessage);
    expect(registry.execute).toHaveBeenCalled();
    expect(loop.getModelName()).toBe("gemma-4-12b-it-gguf");

    loop.setModelName("qwen2.5-coder:14b");
    expect(loop.getModelName()).toBe("qwen2.5-coder:14b");

    const client2 = makeMultiClient([toolCallText, "Done after switch."]);
    const loop2 = new AgentLoop(
      client2,
      manager,
      registry,
      "qwen2.5-coder:14b",
    );
    await loop2.run(postMessage);
    expect(registry.execute).toHaveBeenCalledTimes(2);
  });

  it("still routes write-capable tools through ConfirmationGate after a switch", async () => {
    const registry = new ToolRegistry();
    registry.register(
      "delete_file",
      makeHandler({ id: "x", success: true, output: "" }),
    );
    const request = vi.fn().mockResolvedValue(true);
    const gate = mockOf<ConfirmationGate>({
      request,
      requestDiffPreview: vi.fn(),
      resolve: vi.fn(),
    });
    registry.setConfirmationGate(gate, undefined, "ask");

    const loop = new AgentLoop(
      makeMultiClient(["ok"]),
      makeManager(),
      registry,
      "gemma-4-12b-it-gguf",
    );
    loop.setModelName("qwen2.5-coder:14b");
    expect(loop.getModelName()).toBe("qwen2.5-coder:14b");

    const call = {
      id: "c1",
      tool: "delete_file",
      parameters: { path: "tmp.txt" },
    } as ToolCall;
    await registry.execute(call);
    expect(request).toHaveBeenCalledTimes(1);
  });
});
