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
  agentType:
    | "verification"
    | "research"
    | "planning"
    | "audit-worker"
    | "testgaps-worker";
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

// ---------------------------------------------------------------------------
// v0.7.0 Phase 4 -- Webview render protocol expansion (ADR-0008)
// ---------------------------------------------------------------------------

/** Phase 4.2 -- a tool call has begun executing. */
export interface RenderToolCallStartedMessage {
  type: "renderToolCallStarted";
  callId: string;
  toolName: string;
  /** Whitelisted to scalar values; the runtime renders them as the action target. */
  params: Record<string, string | number | boolean | null>;
}

/** Phase 4.1 + 4.2 -- a tool call has completed; for edits this carries before/after for the diff card. */
export interface RenderToolCallCompletedMessage {
  type: "renderToolCallCompleted";
  callId: string;
  toolName: string;
  /** Optional before/after pair for edit-class tools (write_file, edit_file, create_file). */
  diff?: {
    filePath: string;
    before: string;
    after: string;
  };
  /** Optional badge text (e.g., "5.16s", "Lines 23-150", "Added 128 lines"). */
  badge?: string;
}

/** Phase 4.2 -- a tool call has failed. */
export interface RenderToolCallFailedMessage {
  type: "renderToolCallFailed";
  callId: string;
  toolName: string;
  error: string;
}

/** Phase 4.4 -- the agent's structured todo list. */
export interface RenderTodoUpdateMessage {
  type: "renderTodoUpdate";
  todos: Array<{
    content: string;
    activeForm: string;
    status: "pending" | "in_progress" | "completed";
  }>;
}

/** Phase 4 -- compaction events emitted by the agent loop. */
export interface RenderCompactionEventMessage {
  type: "renderCompactionEvent";
  text: string;
}

/** Phase 4.7 -- end-of-task completion report. */
export interface RenderCompletionReportMessage {
  type: "renderCompletionReport";
  items: Array<{
    field: string;
    value: string;
    /** When set, the value is rendered as a clickable link. */
    href?: string;
  }>;
}

/** Phase 4.5 -- thought-for-Xs meta-row events. */
export interface RenderThoughtMetaRowMessage {
  type: "renderThoughtMetaRow";
  status: "thinking" | "complete";
  durationMs: number | null;
}

/**
 * Phase 4.6 + v0.8.0 Phase 0.3 (closes v0.7.0 10.O.1) -- toggle the
 * queued-message field. The host emits this alongside `status` transitions:
 * `{ visible: true }` on stream start so the webview replaces the input row
 * with the queued-message field; `{ visible: false }` on stream end (idle) or
 * cancel so the input row is restored.
 */
export interface RenderQueuedMessageFieldMessage {
  type: "renderQueuedMessageField";
  visible: boolean;
}

/** Phase 4.3 -- numbered permission prompt (replaces the legacy modal Yes/No card). */
export interface RenderPermissionPromptMessage {
  type: "renderPermissionPrompt";
  id: string;
  toolName: string;
  description: string;
  /** Optional command echo (e.g., shell command line for run_terminal). */
  commandEcho: string | null;
  options: Array<{
    key: "1" | "2" | "3" | "4";
    label: string;
    value: "yes" | "yes-for-all" | "no" | "freeform";
    aliases: string[];
  }>;
}

/**
 * Phase 9 (v0.5.0) -- Sends cache and compression observability data to the
 * trace dashboard. Refresh cadence matches MetricsCollector buffer flush
 * cadence (5 s).
 */
export interface CacheStatsMessage {
  type: "cacheStats";
  /** Cumulative pre-compression bytes minus post-compression bytes. */
  compressionSavedBytes: number;
  compressionOriginalBytes: number;
  compressionCompressedBytes: number;
  /** `tool-output-cache` LRU hit/miss snapshot. */
  toolOutputCache: {
    entries: number;
    hits: number;
    misses: number;
    bytes: number;
    topByHits: Array<{ absolutePath: string; hits: number }>;
  };
  /** `web-response-cache` hit/miss snapshot (or null when disabled). */
  webResponseCache: {
    entries: number;
    hits: number;
    misses: number;
    expired: number;
  } | null;
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
  | TraceMetricsMessage
  | CacheStatsMessage
  | RenderToolCallStartedMessage
  | RenderToolCallCompletedMessage
  | RenderToolCallFailedMessage
  | RenderTodoUpdateMessage
  | RenderCompactionEventMessage
  | RenderCompletionReportMessage
  | RenderThoughtMetaRowMessage
  | RenderPermissionPromptMessage
  | RenderQueuedMessageFieldMessage;

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

/** v0.8.0 Phase 1.4 -- approve the entire plan with attached implementation notes. */
export interface PlanApproveWithNotesMessage {
  type: "planApproveWithNotes";
  notes: string;
}

/** v0.8.0 Phase 1.2 -- deny the current plan with feedback for the model. */
export interface PlanDenyMessage {
  type: "planDeny";
  feedback: string;
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

/** Phase 9: requests an updated cache-stats snapshot. */
export interface RequestCacheStatsMessage {
  type: "requestCacheStats";
}

/** Phase 4.3 -- the user's choice from a numbered permission prompt. */
export interface PermissionPromptResponseMessage {
  type: "permissionPromptResponse";
  id: string;
  /** Which option was chosen. `freeform` carries the user's instruction in `freeformText`. */
  value: "yes" | "yes-for-all" | "no" | "freeform";
  freeformText?: string;
}

export type WebviewToExtensionMessage =
  | SendMessageRequest
  | ClearChatRequest
  | CancelStreamRequest
  | ReadyRequest
  | ConfirmationResponseMessage
  | RequestCommandListMessage
  | ApproveStepMessage
  | PlanApproveWithNotesMessage
  | PlanDenyMessage
  | LoadSessionRequest
  | SetEditModeRequest
  | RollbackRequest
  | RequestTraceListMessage
  | RequestTraceDetailMessage
  | RequestTraceMetricsMessage
  | RequestCacheStatsMessage
  | PermissionPromptResponseMessage;
