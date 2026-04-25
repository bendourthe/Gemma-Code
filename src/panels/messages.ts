import type { Message, ConversationSession } from "../chat/types.js";
import type { CommandDescriptor } from "../commands/CommandRouter.js";
import type { PlanStep } from "../chat/PlanMode.js";
import type { EditMode } from "../tools/types.js";
import type { Span } from "../observability/TraceStore.js";
import type { SessionMetrics } from "../observability/MetricsCollector.js";

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

/** Updates the memory-system status badge in the webview header. */
export interface MemoryStatusMessage {
  type: "memoryStatus";
  enabled: boolean;
  entryCount: number;
}

/** Updates the MCP connection badge in the webview header. */
export interface McpStatusMessage {
  type: "mcpStatus";
  enabled: boolean;
  connectedServerCount: number;
  totalToolCount: number;
}

/** Updates the thinking mode indicator in the webview header. */
export interface ThinkingModeMessage {
  type: "thinkingModeStatus";
  active: boolean;
}

/** Notifies the webview of a tool call's risk classification. */
export interface ActionClassificationMessage {
  type: "actionClassification";
  callId: string;
  risk: string;
  reason: string;
}

/** Notifies the webview that a git safety checkpoint was created. */
export interface GitCheckpointMessage {
  type: "gitCheckpoint";
  sha: string;
  filesChanged: number;
}

/** Reports DAG execution progress (node completion counts and currently running nodes). */
export interface DAGProgressMessage {
  type: "dagProgress";
  total: number;
  completed: number;
  failed: number;
  running: number;
  currentNodes: string[];
}

/** Sends the DAG structure to the webview for visualization. */
export interface DAGVisualizationMessage {
  type: "dagVisualization";
  nodes: Array<{
    id: string;
    title: string;
    status: string;
    dependencies: string[];
  }>;
}

/** Notifies the webview that the orchestrator is replanning due to divergence. */
export interface ReplanningMessage {
  type: "replanning";
  attempt: number;
  reason: string;
  failedNodes: string[];
}

/** Sends a list of recent traces to the trace dashboard webview. */
export interface TraceListMessage {
  type: "traceList";
  traces: Array<{
    traceId: string;
    startTime: number;
    durationMs: number;
    spanCount: number;
    status: string;
  }>;
}

/** Sends the full span tree for a single trace to the trace dashboard. */
export interface TraceDetailMessage {
  type: "traceDetail";
  traceId: string;
  spans: Span[];
}

/** Sends computed session metrics for a trace to the trace dashboard. */
export interface TraceMetricsMessage {
  type: "traceMetrics";
  metrics: SessionMetrics;
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
  | SubAgentStatusMessage
  | MemoryStatusMessage
  | McpStatusMessage
  | ThinkingModeMessage
  | ActionClassificationMessage
  | GitCheckpointMessage
  | DAGProgressMessage
  | DAGVisualizationMessage
  | ReplanningMessage
  | TraceListMessage
  | TraceDetailMessage
  | TraceMetricsMessage;

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

/** Sent when the user requests a rollback to a git safety checkpoint. */
export interface RollbackRequest {
  type: "rollbackRequest";
}

/** Requests the list of recent traces from the extension. */
export interface RequestTraceListMessage {
  type: "requestTraceList";
}

/** Requests full trace detail for a specific trace. */
export interface RequestTraceDetailMessage {
  type: "requestTraceDetail";
  traceId: string;
}

/** Requests computed metrics for a specific trace. */
export interface RequestTraceMetricsMessage {
  type: "requestTraceMetrics";
  traceId: string;
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
  | SetEditModeRequest
  | RollbackRequest
  | RequestTraceListMessage
  | RequestTraceDetailMessage
  | RequestTraceMetricsMessage;
