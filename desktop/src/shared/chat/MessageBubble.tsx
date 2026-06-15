/**
 * v1.0.0 Phase 4.4 -- shared message bubble.
 *
 * Renders a single chat message with a role-coloured bubble + optional
 * tool-call cards. Tool cards are an opt-in prop because the Chat module
 * disables tool-call UI by default (see `<MessageList enableTools>`).
 */

import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from "react";
import type { ChatMessage, ToolCard } from "./types";

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
  return (
    <article
      data-testid={`message-bubble-${message.id}`}
      data-role={message.role}
      {...(selectable
        ? {
            role: "button",
            tabIndex: 0,
            "aria-label": `Preview ${labelForRole(message.role)} message`,
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
      <header style={{ marginBottom: "var(--space-1)", color: "var(--fg-muted)", fontSize: "var(--text-xs)" }}>
        {labelForRole(message.role)}
      </header>
      <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{message.content}</p>
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

function labelForRole(role: ChatMessage["role"]): string {
  if (role === "user") return "You";
  if (role === "assistant") return "Assistant";
  return "System";
}

function bubbleStyle(role: ChatMessage["role"], selectable = false): CSSProperties {
  return {
    padding: "var(--space-2) var(--space-3)",
    borderRadius: "var(--radius-md)",
    border: "1px solid var(--border-1)",
    backgroundColor: role === "user" ? "transparent" : "var(--bg-1)",
    color: "var(--fg-0)",
    ...(selectable ? { cursor: "pointer" } : {}),
  };
}
