import type { Message, ConversationSession } from "../chat/types.js";
import type { CommandDescriptor } from "../commands/CommandRouter.js";
import type { PlanStep } from "../modes/PlanMode.js";
import type { EditMode } from "../tools/types.js";

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
  /** Pre-rendered HTML from the server-side Markdown renderer. */
  renderedHtml: string;
}

export interface HistoryMessage {
  type: "history";
  messages: readonly Message[];
  /** Pre-rendered HTML for each non-system message, keyed by message id. */
  renderedHtmlMap: Record<string, string>;
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

/** Shown during and after context compaction. Empty string hides the banner. */
export interface CompactionStatusMessage {
  type: "compactionStatus";
  text: string;
}

/** Updates the token-count indicator in the webview header. */
export interface TokenCountMessage {
  type: "tokenCount";
  count: number;
  limit: number;
}

/** Renders the history list inside the webview (for /history command). */
export interface SessionListMessage {
  type: "sessionList";
  sessions: ConversationSession[];
}

/** Sends the current edit mode to the webview so the selector reflects it. */
export interface EditModeChangedMessage {
  type: "editModeChanged";
  mode: EditMode;
}

/**
 * Shows a diff preview in the webview for "ask" or "manual" edit modes.
 * For "ask" mode this is paired with a confirmationRequest card.
 * For "manual" mode it is shown standalone with no action buttons.
 */
export interface DiffPreviewMessage {
  type: "diffPreview";
  callId: string;
  filePath: string;
  diff: string;
  requiresConfirmation: boolean;
}

/** Shows sub-agent status in the webview (spinner while running, summary on complete). */
export interface SubAgentStatusMessage {
  type: "subAgentStatus";
  agentType: "verification" | "research" | "planning";
  state: "running" | "complete" | "error";
  summary?: string;
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
  | PlanModeToggledMessage
  | CompactionStatusMessage
  | TokenCountMessage
  | SessionListMessage
  | EditModeChangedMessage
  | DiffPreviewMessage
  | SubAgentStatusMessage;

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

/** Sent when the user clicks a session in the history list. */
export interface LoadSessionRequest {
  type: "loadSession";
  sessionId: string;
}

/** Sent when the user changes the edit mode via the header selector. */
export interface SetEditModeRequest {
  type: "setEditMode";
  mode: EditMode;
}

export type WebviewToExtensionMessage =
  | SendMessageRequest
  | ClearChatRequest
  | CancelStreamRequest
  | ReadyRequest
  | ConfirmationResponseMessage
  | RequestCommandListMessage
  | ApproveStepMessage
  | LoadSessionRequest
  | SetEditModeRequest;
