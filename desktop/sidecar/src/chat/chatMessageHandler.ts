// v1.7.0 -- Local Chatbot Explorer: the non-agentic chat message handler.
//
// Where the Coding pillar runs a full agent loop, the Chat pillar is a plain
// chatbot: send the conversation to a local model and stream the reply. This
// handler wraps the vscode-free `createHeadlessOllamaClient` (no tools, no
// loop) and maps stream chunks onto the `token` / `done` IPC event union.
// Never throws -- an LLM failure is surfaced as a trailing `done` event.

import { createHeadlessOllamaClient } from "../../../../modules/coding/llm/headlessOllamaClient.js";
import type { LLMClient, LLMMessage } from "../../../../modules/coding/llm/types.js";
import type { ChatSessionEventT } from "../protocol.js";
import type { SidecarModelEntry } from "../coding/models.js";

export interface ChatRunnerInput {
  readonly sessionId: string;
  readonly model: SidecarModelEntry;
  /** Full conversation so far (system + prior turns + the new user message). */
  readonly messages: readonly LLMMessage[];
  readonly signal?: AbortSignal;
}

/** Runs one chat turn and returns the mapped IPC event stream. */
export type ChatRunner = (input: ChatRunnerInput) => Promise<readonly ChatSessionEventT[]>;

export interface ChatMessageHandlerOptions {
  /** Override the LLM port (tests inject a scripted client; default: Ollama). */
  readonly llm?: LLMClient;
}

/**
 * Build the production chat runner. Streams the conversation through the local
 * model and collects token events; a fresh client call per turn. Errors become
 * a `done` event with an `error: ...` reason so the IPC contract always holds.
 */
export function createChatMessageHandler(
  options: ChatMessageHandlerOptions = {},
): ChatRunner {
  const llm = options.llm ?? createHeadlessOllamaClient();
  return async (input) => {
    const events: ChatSessionEventT[] = [];
    try {
      for await (const chunk of llm.streamChat(
        { model: input.model.id, messages: [...input.messages], stream: true },
        input.signal,
      )) {
        const delta = chunk.message?.content ?? "";
        if (delta) events.push({ kind: "token", text: delta });
        if (chunk.done) break;
      }
      events.push({ kind: "done", finishReason: "stop" });
    } catch (err) {
      events.push({
        kind: "done",
        finishReason: `error: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
    return events;
  };
}
