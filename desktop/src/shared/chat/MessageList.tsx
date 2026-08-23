/**
 * v1.0.0 Phase 4.4 -- shared message list.
 *
 * v2.2.2: each row is a flex line (user flex-end, assistant flex-start) so
 * fit-content bubbles can sit on the right or left. Image Studio / Video Lab
 * pass `renderAfter` for per-message actions instead of a custom <ul>.
 */

import type { ReactNode } from "react";
import { MessageBubble } from "./MessageBubble";
import type { ChatMessage } from "./types";

export interface MessageListProps {
  messages: readonly ChatMessage[];
  enableTools?: boolean;
  emptyMessage?: string;
  emptyTestId?: string;
  /**
   * v1.5.0 Phase 5 (item 24) -- when provided, each bubble becomes selectable
   * so the host can open the message's output in the side-by-side preview pane.
   */
  onSelectMessage?: (message: ChatMessage) => void;
  /** Optional trailing chrome (download / recall) still aligned with the bubble. */
  renderAfter?: (message: ChatMessage) => ReactNode;
}

export function messageRowAlign(role: ChatMessage["role"]): "flex-end" | "flex-start" {
  return role === "user" ? "flex-end" : "flex-start";
}

export function MessageList({
  messages,
  enableTools = true,
  emptyMessage = "Start by asking a question or typing a message.",
  emptyTestId = "message-list-empty",
  onSelectMessage,
  renderAfter,
}: MessageListProps): JSX.Element {
  if (messages.length === 0) {
    return (
      <p data-testid={emptyTestId} style={{ color: "var(--fg-muted)" }}>
        {emptyMessage}
      </p>
    );
  }
  return (
    <ul
      data-testid="message-list"
      style={{
        listStyle: "none",
        padding: 0,
        margin: 0,
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-3)",
        width: "100%",
      }}
    >
      {messages.map((msg) => (
        <li
          key={msg.id}
          data-testid={`message-row-${msg.id}`}
          data-role={msg.role}
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: messageRowAlign(msg.role),
            width: "100%",
          }}
        >
          <MessageBubble
            message={msg}
            enableTools={enableTools}
            {...(onSelectMessage ? { onSelect: onSelectMessage } : {})}
          />
          {renderAfter?.(msg)}
        </li>
      ))}
    </ul>
  );
}
