import type { Message } from "../chat/types.js";

// ---------------------------------------------------------------------------
// Extension → Webview
// ---------------------------------------------------------------------------

export interface TokenMessage {
  type: "token";
  value: string;
}

export interface MessageCompleteMessage {
  type: "messageComplete";
  messageId: string;
}

export interface HistoryMessage {
  type: "history";
  messages: readonly Message[];
}

export interface ErrorMessage {
  type: "error";
  text: string;
}

export interface StatusMessage {
  type: "status";
  state: "idle" | "thinking" | "streaming";
}

export type ExtensionToWebviewMessage =
  | TokenMessage
  | MessageCompleteMessage
  | HistoryMessage
  | ErrorMessage
  | StatusMessage;

// ---------------------------------------------------------------------------
// Webview → Extension
// ---------------------------------------------------------------------------

export interface SendMessageRequest {
  type: "sendMessage";
  text: string;
}

export interface ClearChatRequest {
  type: "clearChat";
}

export interface CancelStreamRequest {
  type: "cancelStream";
}

export interface ReadyRequest {
  type: "ready";
}

export type WebviewToExtensionMessage =
  | SendMessageRequest
  | ClearChatRequest
  | CancelStreamRequest
  | ReadyRequest;
