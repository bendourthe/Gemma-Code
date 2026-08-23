/**
 * v1.0.0 Phase 4.4 -- shared message bubble.
 *
 * v2.2.2: user right / assistant left is owned by MessageList. The bubble
 * itself is fit-content, max 80% of the transcript pane, with no You /
 * Assistant labels on normal turns. Tool cards keep their name.
 */

import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import type { ChatMessage, ToolCard } from "./types";
import { AgentStateOrb } from "../../components/agentState/AgentStateOrb";

export interface MessageBubbleProps {
  message: ChatMessage;
  /** When false, tool-call cards are omitted from the rendered output. */
  enableTools?: boolean;
  /**
   * v1.5.0 Phase 5 (item 24) -- when provided, the bubble becomes selectable
   * (click / Enter / Space) so the host can open the message's output in the
   * side-by-side preview pane. Omitted by default; non-preview hosts (e.g. the
   * Coding pillar) render a static bubble unchanged.
   */
  onSelect?: (message: ChatMessage) => void;
}

export function MessageBubble({
  message,
  enableTools = true,
  onSelect,
}: MessageBubbleProps): JSX.Element {
  const selectable = Boolean(onSelect);
  const handleSelect = () => onSelect?.(message);
  const caption = captionFor(message);
  return (
    <article
      data-testid={`message-bubble-${message.id}`}
      data-role={message.role}
      {...(selectable
        ? {
            role: "button",
            tabIndex: 0,
            "aria-label": `Preview ${ariaRole(message.role)} message`,
            onClick: handleSelect,
            onKeyDown: (e: ReactKeyboardEvent) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handleSelect();
              }
            },
          }
        : {})}
      style={bubbleStyle(message.role, selectable)}
    >
      {caption}
      {message.content && <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{message.content}</p>}
      {message.attachments && message.attachments.length > 0 && (
        <div
          data-testid={`message-attachments-${message.id}`}
          style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-1)", marginTop: "var(--space-2)" }}
        >
          {message.attachments.map((src, i) => (
            <img
              key={i}
              src={src}
              alt="Attachment"
              data-testid={`message-attachment-${message.id}-${i}`}
              style={{ maxWidth: 96, maxHeight: 96, borderRadius: "var(--radius-sm)", objectFit: "cover" }}
            />
          ))}
        </div>
      )}
      {message.pending && (
        <div
          data-testid={`message-pending-${message.id}`}
          style={{ marginTop: "var(--space-2)", color: "var(--fg-muted)", display: "flex", alignItems: "center", gap: "var(--space-2)" }}
        >
          <AgentStateOrb
            activity={message.activity ?? "chat-streaming"}
            size="inline"
            surfaceId={`message-${message.id}`}
          />
          {message.progress && message.progress.total > 0 && (
            <progress value={message.progress.step} max={message.progress.total} />
          )}
        </div>
      )}
      {message.media &&
        (message.media.kind === "image" ? (
          <img
            data-testid={`message-media-${message.id}`}
            src={message.media.src}
            alt={message.content || "Generated image"}
            style={{ maxWidth: "100%", borderRadius: "var(--radius-md)", marginTop: "var(--space-2)" }}
          />
        ) : (
          <video
            data-testid={`message-media-${message.id}`}
            src={message.media.src}
            controls
            style={{ maxWidth: "100%", borderRadius: "var(--radius-md)", marginTop: "var(--space-2)" }}
          />
        ))}
      {enableTools && message.toolCards && message.toolCards.length > 0 && (
        <ul
          data-testid={`message-bubble-tools-${message.id}`}
          style={{ listStyle: "none", padding: 0, margin: "var(--space-2) 0 0", display: "flex", flexDirection: "column", gap: "var(--space-1)" }}
        >
          {message.toolCards.map((card) => (
            <li key={card.callId}>
              <ToolCardView card={card} />
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

function ToolCardView({ card }: { card: ToolCard }): JSX.Element {
  return (
    <div
      data-testid={`tool-card-${card.callId}`}
      style={{
        border: "1px solid var(--border-1)",
        padding: "var(--space-2)",
        borderRadius: "var(--radius-md)",
        backgroundColor: "var(--bg-1)",
      }}
    >
      <header>
        <strong>{card.name}</strong>
      </header>
      <pre style={{ whiteSpace: "pre-wrap", margin: 0 }}>{card.args}</pre>
      {card.result !== null && (
        <p style={{ margin: "var(--space-1) 0 0", color: "var(--fg-muted)" }}>
          -&gt; {card.result}
        </p>
      )}
    </div>
  );
}

function captionFor(message: ChatMessage): ReactNode {
  if (message.role === "system") {
    return (
      <header style={{ marginBottom: "var(--space-1)", color: "var(--fg-muted)", fontSize: "var(--text-xs)" }}>
        System
      </header>
    );
  }
  if (message.origin === "stt_transcript") {
    return (
      <span data-testid={`message-origin-${message.id}`} style={{ color: "var(--fg-muted)", fontSize: "var(--text-xs)" }}>
        origin:stt_transcript
      </span>
    );
  }
  return null;
}

function ariaRole(role: ChatMessage["role"]): string {
  if (role === "user") return "your";
  if (role === "assistant") return "assistant";
  return "system";
}

function bubbleStyle(role: ChatMessage["role"], selectable = false): CSSProperties {
  const user = role === "user";
  const system = role === "system";
  return {
    width: "fit-content",
    maxWidth: "80%",
    boxSizing: "border-box",
    padding: "var(--space-2) var(--space-3)",
    borderRadius: "var(--radius-lg, 12px)",
    border: `1px solid ${user ? "var(--border-subtle, #2a2a2a)" : "var(--border-1)"}`,
    backgroundColor: system
      ? "transparent"
      : user
        ? "color-mix(in srgb, var(--bg-2, #2a2a2a) 70%, transparent)"
        : "color-mix(in srgb, var(--bg-1, #1b1b1b) 85%, transparent)",
    color: "var(--fg-0)",
    ...(selectable ? { cursor: "pointer" } : {}),
  };
}
