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
  | { kind: "done"; finishReason?: string };

export interface ChatStartResult {
  sessionId: string;
  modelId: string;
  createdAt: string;
}

export interface ChatSendResult {
  sessionId: string;
  events: ChatStreamEvent[];
}

export interface ChatSessionClient {
  start(input: { modelId: string; title?: string }): Promise<ChatStartResult>;
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

export function createChatIpcClient(): ChatSessionClient {
  return {
    async start(input) {
      const reply = await ipcCall<ChatStartResult>("chat.session.start", {
        modelId: input.modelId,
        ...(input.title ? { title: input.title } : {}),
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
