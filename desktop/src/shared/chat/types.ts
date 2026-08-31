/**
 * v1.0.0 Phase 4.4 -- shared chat-shell type surface.
 *
 * Both the Agentic AI Coding module and the Local Chatbot Explorer module
 * render against these types. Tool-call cards are intentionally kept under
 * the Coding module's `toolCallCard.ts` because the Chat module disables
 * them by default; the shared shell only carries the message-bubble +
 * input + model-selector contract.
 */

import type { AgentActivity } from "../../components/agentState/mapping";
import type { MessageTokenUsageV1, RequestTokenUsageV1 } from "../../../../core/chat/tokenUsage";

export type ChatRole = "user" | "assistant" | "system";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  /**
   * Pre-rendered plain text body. Markdown rendering is the consumer's
   * responsibility (the Coding module re-uses `applyEvents` to render
   * streamed tokens + tool cards; the Chat module wraps content in a
   * `<MessageBubble>` directly).
   */
  content: string;
  /** Optional tool-call cards to render below the message (Coding only). */
  toolCards?: readonly ToolCard[];
  /** ISO timestamp; the bubble shows a discrete local clock when parseable. */
  timestamp?: string;

  /*
   * v1.15.0 Phase 5 -- media-chat additions for the Image Studio / Video Lab
   * chat surfaces. All optional, so the text-only Chat / Coding paths are
   * unchanged.
   */
  /** Data URLs the user attached to this message (rendered as thumbnails). */
  attachments?: readonly string[];
  /** A generated output rendered inline in the bubble. */
  media?: ChatMedia;
  /** True while an assistant message's generation is still in flight. */
  pending?: boolean;
  /** Optional step/total progress for a pending generation. */
  progress?: { readonly step: number; readonly total: number };
  /**
   * v1.17.0 Phase 2 -- agent activity driving the inline orb while this
   * message is pending. Surfaces pass a typed activity; the bubble maps it
   * to state + accent. Defaults to chat-streaming when omitted.
   */
  activity?: AgentActivity;
  /**
   * v2.0.0 Phase 1 -- provenance class for labelled content (STT transcripts).
   */
  origin?: "stt_transcript" | "user";
  /** v2.2.7 Phase 2 -- null when the backend did not report usage. */
  inputTokens?: number | null;
  reasoningTokens?: number | null;
  outputTokens?: number | null;
  tokensEstimated?: boolean;
  /** Request-wide provider telemetry, never displayed on a message bubble. */
  requestUsage?: RequestTokenUsageV1;
  /** Usage attributable only to this visible message. */
  messageUsage?: MessageTokenUsageV1;
  /** Provider-exposed reasoning content only. Never inferred from ordinary output. */
  reasoningText?: string | null;
  /** v2.4.1 -- shared Image/Video runtime recovery state. */
  mediaRecovery?: MediaRuntimeRecovery;
  /** v2.4.2 Phase 3 -- SAM2 missing-weights recovery (install or paint a mask). */
  sam2Recovery?: Sam2Recovery;
}

export interface MediaRuntimeRecovery {
  readonly state: "repairable" | "repairing" | "failed";
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly progress: number;
  readonly details?: string;
  readonly logPath?: string;
}

export interface Sam2Recovery {
  readonly modelId: string;
  readonly message: string;
  readonly installing?: boolean;
  readonly installed?: boolean;
}

export interface ChatMedia {
  readonly kind: "image" | "video";
  /** A full data URL, e.g. `data:image/png;base64,...`. */
  readonly src: string;
}

export interface ToolCard {
  callId: string;
  name: string;
  args: string;
  result: string | null;
}

export interface ModelOption {
  id: string;
  displayName: string;
  /** v1.19.0 Phase 1 -- catalog task, when the option is catalog-backed. */
  task?: string;
  /** v1.19.0 Phase 1 -- ungated commercial-use restriction, shown as option title. */
  licenseNote?: string;
  /** v1.18.0 Phase 3 (OW-A4) -- verified for agentic tool-calling. */
  toolCallingVerified?: boolean;
  toolCallingBenchmark?: {
    readonly suite: string;
    readonly date: string;
    readonly result: string;
  };
}
