/**
 * v1.0.0 Phase 4.4 -- shared chat-shell type surface.
 *
 * Both the Agentic AI Coding module and the Local Chatbot Explorer module
 * render against these types. Tool-call cards are intentionally kept under
 * the Coding module's `toolCallCard.ts` because the Chat module disables
 * them by default; the shared shell only carries the message-bubble +
 * input + model-selector contract.
 */

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
  /** ISO timestamp; the bubble shows a humanised "x seconds ago" label. */
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
}
