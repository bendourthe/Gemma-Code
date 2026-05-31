/**
 * E2E: full AgentLoop pipeline with a mocked OllamaClient.
 *
 * Instantiates a real `AgentLoop` (not a stub), wires it to a mocked
 * streaming client, real ConversationManager, and real ToolRegistry, and
 * exercises:
 *   - a single-turn answer with no tool call;
 *   - a multi-turn tool-call + continuation;
 *   - cancellation between turns.
 *
 * Requires no external service.
 */

import { describe, it, expect, vi } from "vitest";
import { AgentLoop } from "../../../src/tools/AgentLoop.js";
import { ConversationManager } from "../../../modules/coding/chat/ConversationManager.js";
import { ToolRegistry } from "../../../src/tools/ToolRegistry.js";
import type {
  ToolHandler,
  ToolResult,
} from "../../../src/tools/types.js";
import type { ExtensionToWebviewMessage } from "../../../src/panels/messages.js";
import {
  makeMultiResponseOllamaClient,
  makeOllamaClient,
} from "../../helpers/factories.js";

function makeToolHandler(
  output: string,
  success = true,
): ToolHandler {
  return {
    execute: async (): Promise<ToolResult> => ({
      id: "tc-mock",
      success,
      output,
    }),
  };
}

function collectPosted(): {
  posted: ExtensionToWebviewMessage[];
  postMessage: (m: ExtensionToWebviewMessage) => void;
} {
  const posted: ExtensionToWebviewMessage[] = [];
  return {
    posted,
    postMessage: (m) => posted.push(m),
  };
}

describe("e2e: real AgentLoop with mocked OllamaClient", () => {
  it("runs a single turn and posts messageComplete when there is no tool call", async () => {
    const client = makeOllamaClient("Here is a direct answer to the question.");
    const manager = new ConversationManager("You are Gemma Code.");
    const registry = new ToolRegistry();
    registry.register("read_file", makeToolHandler(""));
    // v0.8.0 Phase 2: this e2e validates single-turn no-tool flow; the
    // pass-state gate would inject a verification nudge and rerun an
    // empty iteration. Disable the gate so the test stays focused on
    // the original mechanics.
    const loop = new AgentLoop(
      client,
      manager,
      registry,
      "gemma4:e4b",
      20,
      undefined,
      undefined,
      undefined,
      { passStateGating: false },
    );
    const { posted, postMessage } = collectPosted();

    manager.addUserMessage("What is 1 + 1?");
    await loop.run(postMessage);

    expect(posted.some((m) => m.type === "token")).toBe(true);
    expect(posted.some((m) => m.type === "messageComplete")).toBe(true);
    const assistantMessages = manager
      .getHistory()
      .filter((m) => m.role === "assistant");
    expect(assistantMessages.at(-1)?.content).toContain("direct answer");
  });

  it("executes a tool call and continues to a final assistant answer", async () => {
    const toolCall =
      '<|tool_call>call:read_file{path:<|"|>src/extension.ts<|"|>}<tool_call|>';
    const client = makeMultiResponseOllamaClient([
      toolCall,                  // turn 1: model issues a tool call
      "Thanks, all set.",        // turn 2: model produces final answer
    ]);
    const manager = new ConversationManager("You are Gemma Code.");
    const registry = new ToolRegistry();
    const readFileHandler = makeToolHandler(
      JSON.stringify({ content: "file bytes", lines: 3 }),
    );
    registry.register("read_file", readFileHandler);
    const executeSpy = vi.spyOn(registry, "execute");
    const loop = new AgentLoop(
      client,
      manager,
      registry,
      "gemma4:e4b",
      20,
      undefined,
      undefined,
      undefined,
      { passStateGating: false },
    );
    const { posted, postMessage } = collectPosted();

    manager.addUserMessage("Read src/extension.ts please.");
    await loop.run(postMessage);

    expect(executeSpy).toHaveBeenCalledTimes(1);
    expect(posted.some((m) => m.type === "toolUse")).toBe(true);
    expect(posted.some((m) => m.type === "toolResult")).toBe(true);
    expect(posted.some((m) => m.type === "messageComplete")).toBe(true);
    // Tool results are injected as synthetic user messages in Gemma 4 format.
    expect(
      manager
        .getHistory()
        .some(
          (m) =>
            m.role === "user" &&
            typeof m.content === "string" &&
            m.content.includes("<|tool_result>"),
        ),
    ).toBe(true);
  });

  it("halts cleanly when cancel() is called before the next iteration", async () => {
    const toolCall =
      '<|tool_call>call:read_file{path:<|"|>src/extension.ts<|"|>}<tool_call|>';
    const client = makeMultiResponseOllamaClient([toolCall, toolCall, toolCall]);
    const manager = new ConversationManager("You are Gemma Code.");
    const registry = new ToolRegistry();
    registry.register("read_file", makeToolHandler("{}"));
    const loop = new AgentLoop(client, manager, registry, "gemma4:e4b", 5);
    const { posted, postMessage } = collectPosted();

    manager.addUserMessage("Keep reading forever.");
    loop.cancel();
    await loop.run(postMessage);

    // With immediate cancellation the loop must not complete the run.
    expect(posted.some((m) => m.type === "messageComplete")).toBe(false);
  });
});
