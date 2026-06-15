/**
 * v1.5.0 Phase 5 (adoption-ecosystem-2026-06 T016) -- side-by-side preview pane.
 *
 * Adopts report item 24 (`re-partial`): render web pages / files / tool outputs
 * beside the chat instead of inline (Hermes Desktop, S5). The pane reuses the
 * existing `InteractiveArtifact` renderer for HTML payloads (so a fetched web
 * page body, an interactive tuning form, or an HTML tool output all share one
 * sanitised render path) and a plain `<pre>` for text / file content.
 *
 * UI only -- the pane never fetches: it displays content already produced by a
 * tool/message. No new outbound dependency, no live iframe (the
 * `InteractiveArtifact` sanitiser forbids `iframe`/`object`/`embed`), honoring
 * the no-outbound default.
 */

import type { CSSProperties } from "react";
import { InteractiveArtifact } from "./InteractiveArtifact";

/** A single artifact the preview pane can render beside the chat. */
export type PreviewArtifact =
  | {
      readonly kind: "html";
      readonly title?: string;
      /** HTML body (sanitised by `InteractiveArtifact` before rendering). */
      readonly html: string;
      /** Optional source URL shown in the header (e.g. a fetched page). */
      readonly sourceUrl?: string;
    }
  | {
      readonly kind: "text";
      readonly title?: string;
      /** Plain text body (file contents / tool output) shown verbatim. */
      readonly text: string;
      readonly sourceUrl?: string;
    };

export interface PreviewPaneProps {
  /** The artifact to render, or `null` to render nothing. */
  readonly artifact: PreviewArtifact | null;
  /** Invoked when the user closes the pane. */
  readonly onClose?: () => void;
  readonly className?: string;
  readonly style?: CSSProperties;
}

function titleFor(artifact: PreviewArtifact): string {
  if (artifact.title) return artifact.title;
  return artifact.kind === "html" ? "Preview" : "Output";
}

/**
 * Render the given artifact in a bordered pane suitable for placing beside the
 * chat in a horizontal flex container. Returns `null` (renders nothing) when no
 * artifact is set, so callers can mount it unconditionally.
 */
export function PreviewPane({
  artifact,
  onClose,
  className,
  style,
}: PreviewPaneProps): JSX.Element | null {
  if (!artifact) return null;

  return (
    <aside
      data-testid="preview-pane"
      className={className}
      aria-label="Preview"
      style={{
        display: "flex",
        flexDirection: "column",
        minWidth: 0,
        borderLeft: "1px solid var(--border-1)",
        backgroundColor: "var(--bg-1)",
        ...style,
      }}
    >
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "var(--space-2)",
          padding: "var(--space-2) var(--space-3)",
          borderBottom: "1px solid var(--border-1)",
        }}
      >
        <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
          <strong data-testid="preview-pane-title" style={{ fontSize: "var(--text-sm)" }}>
            {titleFor(artifact)}
          </strong>
          {artifact.sourceUrl ? (
            <span
              data-testid="preview-pane-source"
              title={artifact.sourceUrl}
              style={{
                fontSize: "var(--text-xs)",
                color: "var(--fg-muted)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {artifact.sourceUrl}
            </span>
          ) : null}
        </span>
        {onClose ? (
          <button
            type="button"
            data-testid="preview-pane-close"
            aria-label="Close preview"
            onClick={onClose}
            style={{
              border: "1px solid var(--border-1)",
              borderRadius: "var(--radius-md)",
              backgroundColor: "var(--bg-2)",
              color: "var(--fg-0)",
              cursor: "pointer",
              padding: "2px 8px",
            }}
          >
            Close
          </button>
        ) : null}
      </header>

      <div
        data-testid="preview-pane-body"
        style={{ flex: 1, overflow: "auto", padding: "var(--space-3)" }}
      >
        {artifact.kind === "html" ? (
          <InteractiveArtifact html={artifact.html} />
        ) : (
          <pre
            data-testid="preview-pane-text"
            style={{
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              margin: 0,
              fontFamily: "var(--font-mono, monospace)",
              fontSize: "var(--text-sm)",
              color: "var(--fg-0)",
            }}
          >
            {artifact.text}
          </pre>
        )}
      </div>
    </aside>
  );
}
