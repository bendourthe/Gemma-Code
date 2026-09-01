/**
 * v1.0.0 Phase 4.4 -- shared message bubble.
 *
 * v2.2.2: user right / assistant left is owned by MessageList. The bubble
 * itself is fit-content, max 80% of the transcript pane, with no You /
 * Assistant labels on normal turns. Tool cards keep their name.
 */

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import type { ChatMessage, ToolCard } from "./types";
import { AgentStateOrb } from "../../components/agentState/AgentStateOrb";
import {
  bubbleTokenMetadata,
  formatBubbleTime,
  parseMessageTime,
} from "./transcriptChrome";
import { ReasoningDisclosure } from "./ReasoningDisclosure";
import { MediaRuntimeRecoveryCard, Sam2RecoveryCard } from "../../components/GenerationCanvas";

const COMPACT_MEDIA_STYLE: CSSProperties = {
  display: "block",
  width: "auto",
  maxWidth: "100%",
  maxHeight: "40vh",
  height: "auto",
  objectFit: "contain",
  background: "transparent",
  borderRadius: "var(--radius-md)",
  marginTop: "var(--space-2)",
  cursor: "zoom-in",
};

export interface MessageBubbleProps {
  message: ChatMessage;
  /** When false, tool-call cards are omitted from the rendered output. */
  enableTools?: boolean;
  /** Lets the owning Studio clear actions and cached output after decode failure. */
  onMediaError?: (message: ChatMessage) => void;
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

export function MessageBubble({
  message,
  enableTools = true,
  onMediaError,
  renderPreviewExtra,
  locale,
  onRepairMediaRuntime,
  onCancelMediaRepair,
  onOpenMediaRepairLog,
  onInstallSam2,
  onPaintSam2Mask,
  onOpenSam2Settings,
  onRetrySam2,
  sam2InstallDisabled = false,
}: MessageBubbleProps): JSX.Element {
  const [mediaFailed, setMediaFailed] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  useEffect(() => setMediaFailed(false), [message.media?.src]);
  useEffect(() => {
    if (!previewOpen) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setPreviewOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [previewOpen]);
  const studioPending = isStudioPending(message);
  const caption = captionFor(message);
  const purePending = Boolean(
    message.pending &&
      !message.content &&
      !message.media &&
      (!message.toolCards || message.toolCards.length === 0),
  );
  if (purePending) {
    return <PendingMessage message={message} studioPending={studioPending} />;
  }
  return (
    <div
      data-testid={`message-shell-${message.id}`}
      style={{
        width: "fit-content",
        maxWidth: message.media ? "min(100%, 28rem)" : "80%",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {message.role === "assistant" ? (
        <ReasoningDisclosure
          messageId={message.id}
          text={message.reasoningText}
          tokenCount={message.reasoningTokens}
        />
      ) : null}
      <article
      data-testid={`message-bubble-${message.id}`}
      data-role={message.role}
      style={bubbleStyle(message)}
    >
      {message.pending ? null : <BubbleMeta message={message} locale={locale} />}
      {message.mediaRecovery ? (
        <MediaRuntimeRecoveryCard
          {...message.mediaRecovery}
          onRepair={() => onRepairMediaRuntime?.(message)}
          onCancel={() => onCancelMediaRepair?.(message)}
          onOpenLog={() => onOpenMediaRepairLog?.(message)}
        />
      ) : null}
      {message.sam2Recovery ? (
        <Sam2RecoveryCard
          {...message.sam2Recovery}
          installDisabled={sam2InstallDisabled}
          onInstall={() => onInstallSam2?.(message)}
          onPaintMask={() => onPaintSam2Mask?.(message)}
          onOpenSettings={() => onOpenSam2Settings?.(message)}
          onRetry={() => onRetrySam2?.(message)}
        />
      ) : null}
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
          style={{
            marginTop: studioPending ? 0 : "var(--space-2)",
            color: "var(--fg-muted)",
            display: "flex",
            flexDirection: "column",
            alignItems: studioPending ? "center" : "flex-start",
            justifyContent: "center",
            gap: "var(--space-2)",
            width: studioPending ? "100%" : "fit-content",
            overflow: "visible",
            // v2.4.4 Phase 1.1: the transcript gutter on MessageList is the
            // only left offset. Adding one here again is what pushed the pill
            // inches into the pane.
            paddingLeft: 0,
            minHeight: studioPending ? "12rem" : "5.5rem",
          }}
        >
          {/* v2.2.9 Phase 2.1 (T006): chat/agents pending is a dark pill that
              cycles Thinking / Searching / Working / Solving with one stable
              accessible name. Image/Video pending stays the hero orb. */}
          <AgentStateOrb
            activity={message.activity ?? "chat-streaming"}
            size={studioPending ? "hero" : "bubble"}
            showCaption
            rotateCaptions={!studioPending}
            accessibleName={studioPending ? undefined : "Generating reply"}
            surfaceId={`message-${message.id}`}
          />
          {message.progress && message.progress.total > 0 && (
            <progress value={message.progress.step} max={message.progress.total} />
          )}
        </div>
      )}
      {mediaFailed ? (
        <p data-testid={`message-media-error-${message.id}`} style={{ color: "var(--danger, #f87171)", margin: 0 }}>
          Generation failed: generated {message.media?.kind ?? "media"} could not be displayed.
        </p>
      ) : message.media ? (
        <>
          {message.media.kind === "image" ? (
            <img
              data-testid={`message-media-${message.id}`}
              src={message.media.src}
              alt={message.content || "Generated image"}
              onClick={(event) => {
                event.stopPropagation();
                setPreviewOpen(true);
              }}
              onError={() => {
                setMediaFailed(true);
                onMediaError?.(message);
              }}
              style={COMPACT_MEDIA_STYLE}
            />
          ) : (
            <video
              data-testid={`message-media-${message.id}`}
              src={message.media.src}
              controls
              onClick={(event) => {
                event.stopPropagation();
                setPreviewOpen(true);
              }}
              onError={() => {
                setMediaFailed(true);
                onMediaError?.(message);
              }}
              style={COMPACT_MEDIA_STYLE}
            />
          )}
          {previewOpen ? (
            <MediaLightbox
              message={message}
              extra={renderPreviewExtra?.(message)}
              onClose={() => setPreviewOpen(false)}
            />
          ) : null}
        </>
      ) : null}
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
    </div>
  );
}

function PendingMessage({
  message,
  studioPending,
}: {
  message: ChatMessage;
  studioPending: boolean;
}): JSX.Element {
  return (
    <div
      data-testid={`message-pending-${message.id}`}
      role="status"
      aria-label={studioPending ? "Generating media" : "Generating reply"}
      style={{
        color: "var(--fg-muted)",
        display: "flex",
        flexDirection: "column",
        alignItems: studioPending ? "center" : "flex-start",
        justifyContent: "center",
        gap: "var(--space-2)",
        width: studioPending ? "100%" : "fit-content",
        maxWidth: studioPending ? "100%" : "min(100%, 24rem)",
        // v2.4.4 Phase 1.1 (T001): no inline padding here. The pending row is
        // an assistant row and takes its left margin from the list gutter, the
        // same one a completed assistant bubble sits on.
        paddingInline: 0,
        boxSizing: "border-box",
        overflow: "visible",
        minHeight: studioPending ? "12rem" : undefined,
      }}
    >
      <AgentStateOrb
        activity={message.activity ?? "chat-streaming"}
        size={studioPending ? "hero" : "bubble"}
        showCaption
        rotateCaptions={!studioPending}
        accessibleName={studioPending ? undefined : "Generating reply"}
        surfaceId={`message-${message.id}`}
      />
      {message.progress && message.progress.total > 0 ? (
        <progress value={message.progress.step} max={message.progress.total} />
      ) : null}
    </div>
  );
}

function BubbleMeta({
  message,
  locale,
}: {
  message: ChatMessage;
  locale?: string;
}): JSX.Element | null {
  const when = parseMessageTime(message.timestamp);
  const tokens = bubbleTokenMetadata(message);
  // Nothing known: no empty chrome row above the text.
  if (!when && !tokens) return null;
  return (
    <div
      data-testid={`message-meta-${message.id}`}
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: "var(--space-4)",
        marginBottom: "var(--space-2)",
        color: "var(--fg-muted)",
        fontSize: "var(--text-xs)",
      }}
    >
      {when ? (
        <time
          data-testid={`message-time-${message.id}`}
          dateTime={when.toISOString()}
        >
          {formatBubbleTime(when, locale)}
        </time>
      ) : null}
      {tokens && message.role === "user" ? (
        <span
          data-testid={`message-tokens-${message.id}`}
          style={{ fontStyle: "italic", marginLeft: "auto" }}
        >
          {tokens.label}
        </span>
      ) : tokens ? (
        <span
          data-testid={`message-tokens-${message.id}`}
          tabIndex={0}
          title={tokens.detail}
          aria-label={`${tokens.label}. ${tokens.detail}`}
          style={{ fontStyle: "italic", marginLeft: "auto" }}
        >
          {tokens.label}
        </span>
      ) : null}
    </div>
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

function MediaLightbox({
  message,
  extra,
  onClose,
}: {
  message: ChatMessage;
  extra?: ReactNode;
  onClose: () => void;
}): JSX.Element {
  const media = message.media;
  let previewNode: HTMLElement | null = null;
  return (
    <div
      data-testid={`message-media-dialog-${message.id}`}
      role="dialog"
      aria-modal="true"
      aria-label="Generated media preview"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 80,
        background: "color-mix(in srgb, #000 72%, transparent)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "var(--space-4)",
      }}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        style={{
          maxWidth: "min(96vw, 64rem)",
          maxHeight: "92vh",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-3)",
          background: "var(--bg-1)",
          borderRadius: "var(--radius-lg)",
          padding: "var(--space-3)",
        }}
      >
        {media?.kind === "image" ? (
          <img
            ref={(node) => {
              previewNode = node;
            }}
            src={media.src}
            alt={message.content || "Generated image"}
            style={{ maxWidth: "90vw", maxHeight: "70vh", objectFit: "contain" }}
          />
        ) : media ? (
          <video
            ref={(node) => {
              previewNode = node;
            }}
            src={media.src}
            controls
            autoPlay
            style={{ maxWidth: "90vw", maxHeight: "70vh" }}
          />
        ) : null}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)" }}>
          <button
            type="button"
            data-testid={`message-media-fullscreen-${message.id}`}
            onClick={() => {
              if (previewNode && typeof previewNode.requestFullscreen === "function") {
                void previewNode.requestFullscreen();
              }
            }}
          >
            Fullscreen
          </button>
          <a
            data-testid={`message-media-download-${message.id}`}
            href={media?.src}
            download={media?.kind === "video" ? `nexus-${message.id}.mp4` : `nexus-${message.id}.png`}
          >
            Download
          </a>
          {media?.kind === "image" ? (
            <button
              type="button"
              data-testid={`message-media-copy-${message.id}`}
              onClick={() => void copyImageSrc(media.src)}
            >
              Copy image
            </button>
          ) : null}
          {extra}
          <button type="button" data-testid={`message-media-close-${message.id}`} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

async function copyImageSrc(src: string): Promise<void> {
  try {
    const blob = await (await fetch(src)).blob();
    const clipboard = typeof navigator !== "undefined" ? navigator.clipboard : undefined;
    if (clipboard && typeof ClipboardItem !== "undefined" && typeof clipboard.write === "function") {
      await clipboard.write([new ClipboardItem({ [blob.type || "image/png"]: blob })]);
      return;
    }
    if (clipboard && typeof clipboard.writeText === "function") {
      await clipboard.writeText(src);
    }
  } catch {
    // Clipboard permission or jsdom gaps must not crash the transcript.
  }
}

function isStudioPending(message: ChatMessage): boolean {
  return Boolean(
    message.pending &&
      (message.activity === "image-generation" || message.activity === "video-generation"),
  );
}

function bubbleStyle(message: ChatMessage): CSSProperties {
  const user = message.role === "user";
  const system = message.role === "system";
  const studioPending = isStudioPending(message);
  if (studioPending) {
    return {
      width: "100%",
      maxWidth: "100%",
      minHeight: "12rem",
      boxSizing: "border-box",
      padding: 0,
      border: "none",
      backgroundColor: "transparent",
      color: "var(--fg-0)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    };
  }
  return {
    width: "fit-content",
    maxWidth: "100%",
    boxSizing: "border-box",
    padding: "var(--space-2) var(--space-3)",
    borderRadius: "var(--radius-lg, 12px)",
    border: "1px solid var(--bubble-border, var(--border-1))",
    backgroundColor: system
      ? "transparent"
      : user
        ? "var(--bubble-user, var(--bg-2))"
        : "var(--bubble-assistant, var(--bg-1))",
    color: "var(--fg-0)",
  };
}
