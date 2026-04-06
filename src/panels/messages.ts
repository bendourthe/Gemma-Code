import type { Message } from "../chat/types.js";
import type { CommandDescriptor } from "../commands/CommandRouter.js";
import type { PlanStep } from "../modes/PlanMode.js";

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

export interface CommandListMessage {
  type: "commandList";
  commands: CommandDescriptor[];
}

export interface PlanReadyMessage {
  type: "planReady";
  steps: string[];
}

export interface PlanModeToggledMessage {
  type: "planModeToggled";
  active: boolean;
  steps?: PlanStep[];
}

export type ExtensionToWebviewMessage =
  | TokenMessage
  | MessageCompleteMessage
  | HistoryMessage
  | ErrorMessage
  | StatusMessage
  | ToolUseMessage
  | ToolResultMessage
  | ConfirmationRequestMessage
  | CommandListMessage
  | PlanReadyMessage
  | PlanModeToggledMessage;

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

export interface RequestCommandListMessage {
  type: "requestCommandList";
}

export interface ApproveStepMessage {
  type: "approveStep";
  step: number;
}

export type WebviewToExtensionMessage =
  | SendMessageRequest
  | ClearChatRequest
  | CancelStreamRequest
  | ReadyRequest
  | ConfirmationResponseMessage
  | RequestCommandListMessage
  | ApproveStepMessage;
