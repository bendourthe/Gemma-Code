/**
 * v1.0.0 Phase 4.4 -- shared message list.
 *
 * Renders an ordered list of `<MessageBubble>` rows with an "empty state"
 * placeholder when no messages exist yet.
 */

import { MessageBubble } from "./MessageBubble";
import type { ChatMessage } from "./types";

export interface MessageListProps {
  messages: readonly ChatMessage[];
  enableTools?: boolean;
  emptyMessage?: string;
  /**
   * v1.5.0 Phase 5 (item 24) -- when provided, each bubble becomes selectable
   * so the host can open the message's output in the side-by-side preview pane.
   */
  onSelectMessage?: (message: ChatMessage) => void;
}

export function MessageList({
  messages,
  enableTools = true,
  emptyMessage = "Start by asking a question or typing a message.",
  onSelectMessage,
}: MessageListProps): JSX.Element {
  if (messages.length === 0) {
    return (
      <p data-testid="message-list-empty" style={{ color: "var(--fg-muted)" }}>
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
      }}
    >
      {messages.map((msg) => (
        <li key={msg.id}>
          <MessageBubble
            message={msg}
            enableTools={enableTools}
            {...(onSelectMessage ? { onSelect: onSelectMessage } : {})}
          />
        </li>
      ))}
    </ul>
  );
}
