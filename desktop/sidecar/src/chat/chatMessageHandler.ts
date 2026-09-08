// v1.7.0 -- Local Chatbot Explorer: the non-agentic chat message handler.
//
// Where the Coding pillar runs a full agent loop, the Chat pillar is a plain
// chatbot: send the conversation to a local model and stream the reply. This
// handler wraps the vscode-free `createHeadlessOllamaClient` (no tools, no
// loop) and maps stream chunks onto the `token` / `done` IPC event union.
// Never throws -- an LLM failure is surfaced as a trailing `done` event.
//
// v2.2.7 Phase 2 -- collect Ollama/OpenAI usage onto the done event. Missing
// usage stays omitted (null at persist), never invented as 0.

import { createHeadlessOllamaClient } from "../../../../modules/coding/llm/headlessOllamaClient.js";
import { redactSecrets } from "../../../../core/observability/redactSecrets.js";
import type { LLMClient, LLMMessage } from "../../../../modules/coding/llm/types.js";
import type { ChatSessionEventT } from "../protocol.js";
import type { SidecarModelEntry } from "../coding/models.js";
import {
  collectUsage,
  doneUsageFields,
  newUsage,
  turnUsageFromCollected,
} from "../serving/chatCore.js";

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

const MAX_REASONING_TEXT_CHARS = 65_536;

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
    const usage = newUsage();
    let thinking = "";
    // v2.4.8 Phase 1 (T002): the visible reply is accumulated so the provider
    // total can be split between reasoning and output by text proportion.
    let reply = "";
    let reasoningCaptured = 0;
    try {
      for await (const chunk of llm.streamChat(
        { model: input.model.id, messages: [...input.messages], stream: true },
        input.signal,
      )) {
        collectUsage(chunk, usage);
        const thinkDelta = chunk.message?.thinking ?? "";
        if (thinkDelta) {
          thinking += thinkDelta;
          const safeDelta = redactSecrets(thinkDelta).slice(
            0,
            Math.max(MAX_REASONING_TEXT_CHARS - reasoningCaptured, 0),
          );
          if (safeDelta) {
            events.push({ kind: "reasoning_delta", text: safeDelta });
            reasoningCaptured += safeDelta.length;
          }
        }
        const delta = chunk.message?.content ?? "";
        if (delta) {
          reply += delta;
          events.push({ kind: "token", text: delta });
        }
        if (chunk.done) break;
      }
      events.push({
        kind: "done",
        finishReason: "stop",
        ...doneUsageFields(turnUsageFromCollected(usage, thinking, reply)),
      });
    } catch (err) {
      events.push({
        kind: "done",
        finishReason: `error: ${err instanceof Error ? err.message : String(err)}`,
        ...doneUsageFields(turnUsageFromCollected(usage, thinking, reply)),
      });
    }
    return events;
  };
}
