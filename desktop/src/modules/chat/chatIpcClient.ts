/**
 * v1.7.0 -- IPC-backed chat-session client for the Local Chatbot Explorer.
 *
 * Talks to the sidecar `chat.session.*` methods (a real local-model chat turn)
 * instead of the Phase 4 in-memory echo stub. The reply is returned as a batch
 * of stream events (token* + done), mirroring the coding session IPC shape.
 */

import { ipcCall } from "../../lib/ipc";

export type ChatStreamEvent =
  | { kind: "token"; text: string }
  | {
      kind: "done";
      finishReason?: string;
      inputTokens?: number | null;
      reasoningTokens?: number | null;
      outputTokens?: number | null;
    };

export interface ChatStartResult {
  sessionId: string;
  modelId: string;
  createdAt: string;
}

export interface ChatReplayMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatSendResult {
  sessionId: string;
  events: ChatStreamEvent[];
}

export interface ChatSessionClient {
  start(input: {
    modelId: string;
    title?: string;
    history?: readonly ChatReplayMessage[];
  }): Promise<ChatStartResult>;
  sendMessage(input: {
    sessionId: string;
    message: string;
    images?: readonly string[];
  }): Promise<ChatSendResult>;
}

/** Collapse the streamed token events into the assistant reply text. */
export function joinChatReply(events: readonly ChatStreamEvent[]): string {
  return events
    .filter((e): e is { kind: "token"; text: string } => e.kind === "token")
    .map((e) => e.text)
    .join("");
}

export interface ChatTurnUsage {
  inputTokens: number | null;
  reasoningTokens: number | null;
  outputTokens: number | null;
}

/** Last done-event usage. Missing counters stay null, never invented as 0. */
export function usageFromChatEvents(events: readonly ChatStreamEvent[]): ChatTurnUsage {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (event && event.kind === "done") {
      return {
        inputTokens: event.inputTokens ?? null,
        reasoningTokens: event.reasoningTokens ?? null,
        outputTokens: event.outputTokens ?? null,
      };
    }
  }
  return { inputTokens: null, reasoningTokens: null, outputTokens: null };
}

export function createChatIpcClient(): ChatSessionClient {
  return {
    async start(input) {
      const reply = await ipcCall<ChatStartResult>("chat.session.start", {
        modelId: input.modelId,
        ...(input.title ? { title: input.title } : {}),
        ...(input.history ? { history: input.history } : {}),
      });
      if (!reply.ok) throw new Error(reply.message);
      return reply.value;
    },
    async sendMessage(input) {
      const reply = await ipcCall<ChatSendResult>("chat.session.sendMessage", {
        sessionId: input.sessionId,
        message: input.message,
        ...(input.images && input.images.length > 0 ? { images: input.images } : {}),
      });
      if (!reply.ok) throw new Error(reply.message);
      return reply.value;
    },
  };
}
