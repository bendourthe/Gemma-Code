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

export interface ToolUseMessage {
  type: "toolUse";
  toolName: string;
  callId: string;
}

export interface ToolResultMessage {
  type: "toolResult";
  callId: string;
  success: boolean;
  summary: string;
}

export interface ConfirmationRequestMessage {
  type: "confirmationRequest";
  id: string;
  description: string;
  detail?: string;
}

export type ExtensionToWebviewMessage =
  | TokenMessage
  | MessageCompleteMessage
  | HistoryMessage
  | ErrorMessage
  | StatusMessage
  | ToolUseMessage
  | ToolResultMessage
  | ConfirmationRequestMessage;

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

export interface ConfirmationResponseMessage {
  type: "confirmationResponse";
  id: string;
  approved: boolean;
}

export type WebviewToExtensionMessage =
  | SendMessageRequest
  | ClearChatRequest
  | CancelStreamRequest
  | ReadyRequest
  | ConfirmationResponseMessage;
