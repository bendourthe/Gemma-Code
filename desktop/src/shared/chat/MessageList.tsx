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
import {
  calendarDayKey,
  formatDateHeading,
  parseMessageTime,
} from "./transcriptChrome";

export interface MessageListProps {
  messages: readonly ChatMessage[];
  enableTools?: boolean;
  emptyMessage?: string;
  emptyTestId?: string;
  /** Called when generated media cannot be decoded by the browser/WebView. */
  onMediaError?: (message: ChatMessage) => void;
  /** Optional trailing chrome (download / copy image) still aligned with the bubble. */
  renderAfter?: (message: ChatMessage) => ReactNode;
  /** v2.2.4 Phase 4 -- extra studio actions inside the media lightbox. */
  renderPreviewExtra?: (message: ChatMessage) => ReactNode;
  /** v2.2.7 Phase 4 -- tests pin `en-US`; production uses the host locale. */
  locale?: string;
  onRepairMediaRuntime?: (message: ChatMessage) => void;
  onCancelMediaRepair?: (message: ChatMessage) => void;
  onOpenMediaRepairLog?: (message: ChatMessage) => void;
  onInstallSam2?: (message: ChatMessage) => void;
  onPaintSam2Mask?: (message: ChatMessage) => void;
  onOpenSam2Settings?: (message: ChatMessage) => void;
  onRetrySam2?: (message: ChatMessage) => void;
  sam2InstallDisabled?: boolean;
}

export function messageRowAlign(role: ChatMessage["role"]): "flex-end" | "flex-start" {
  return role === "user" ? "flex-end" : "flex-start";
}

export function MessageList({
  messages,
  enableTools = true,
  emptyMessage = "Start by asking a question or typing a message.",
  emptyTestId = "message-list-empty",
  onMediaError,
  renderAfter,
  renderPreviewExtra,
  locale,
  onRepairMediaRuntime,
  onCancelMediaRepair,
  onOpenMediaRepairLog,
  onInstallSam2,
  onPaintSam2Mask,
  onOpenSam2Settings,
  onRetrySam2,
  sam2InstallDisabled,
}: MessageListProps): JSX.Element {
  if (messages.length === 0) {
    return (
      <p data-testid={emptyTestId} style={{ color: "var(--fg-muted)" }}>
        {emptyMessage}
      </p>
    );
  }
  const rows: JSX.Element[] = [];
  let lastDay: string | null = null;
  for (const msg of messages) {
    const when = parseMessageTime(msg.timestamp);
    const day = when ? calendarDayKey(when) : null;
    if (day && day !== lastDay && when) {
      lastDay = day;
      rows.push(
        <li
          key={`day-${day}`}
          data-testid={`message-day-${day}`}
          role="separator"
          style={{
            width: "100%",
            alignSelf: "stretch",
            textAlign: "center",
            color: "var(--fg-muted)",
            fontSize: "var(--text-xs)",
            padding: "var(--space-2) 0",
          }}
        >
          {formatDateHeading(when, locale)}
        </li>,
      );
    }
    rows.push(
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
          locale={locale}
          {...(onMediaError ? { onMediaError } : {})}
          {...(renderPreviewExtra ? { renderPreviewExtra } : {})}
          {...(onRepairMediaRuntime ? { onRepairMediaRuntime } : {})}
          {...(onCancelMediaRepair ? { onCancelMediaRepair } : {})}
          {...(onOpenMediaRepairLog ? { onOpenMediaRepairLog } : {})}
          {...(onInstallSam2 ? { onInstallSam2 } : {})}
          {...(onPaintSam2Mask ? { onPaintSam2Mask } : {})}
          {...(onOpenSam2Settings ? { onOpenSam2Settings } : {})}
          {...(onRetrySam2 ? { onRetrySam2 } : {})}
          {...(sam2InstallDisabled ? { sam2InstallDisabled } : {})}
        />
        {renderAfter?.(msg)}
      </li>,
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
      {rows}
    </ul>
  );
}
