/**
 * v2.4.8 follow-up (2026-09-07) -- one centered confirm, portaled to body.
 *
 * Same surface grammar as the FolderTree confirms (backdrop, glass card, quiet
 * cancel), lifted into a reusable component for decisions outside the rail,
 * starting with the chat model switch.
 */

import type { CSSProperties, ReactNode } from "react";
import { createPortal } from "react-dom";
import { Switch } from "../../components/ui";

export interface ConfirmDialogProps {
  readonly title: string;
  readonly body?: ReactNode;
  readonly confirmLabel: string;
  readonly cancelLabel?: string;
  readonly testId?: string;
  /** Optional opt-out, e.g. "Do not ask again". Reads its own checked state. */
  readonly checkbox?: {
    readonly label: string;
    readonly checked: boolean;
    onChange(next: boolean): void;
  };
  onConfirm(): void;
  onCancel(): void;
}

export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  cancelLabel = "Cancel",
  testId = "confirm-dialog",
  checkbox,
  onConfirm,
  onCancel,
}: ConfirmDialogProps): JSX.Element | null {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      data-testid={testId}
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${testId}-title`}
      style={backdropStyle}
      onKeyDown={(event) => {
        if (event.key === "Escape") onCancel();
      }}
    >
      <div style={cardStyle}>
        <h2 id={`${testId}-title`} style={{ margin: 0, fontSize: "var(--text-md)" }}>
          {title}
        </h2>
        {body ? (
          <div style={{ color: "var(--fg-1)", fontSize: "var(--text-sm)" }}>{body}</div>
        ) : null}
        {checkbox ? (
          <Switch
            testId={`${testId}-checkbox`}
            checked={checkbox.checked}
            onChange={checkbox.onChange}
            label={checkbox.label}
          />
        ) : null}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--space-2)" }}>
          <button
            type="button"
            data-testid={`${testId}-cancel`}
            onClick={onCancel}
            style={quietStyle}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            data-testid={`${testId}-confirm`}
            onClick={onConfirm}
            autoFocus
            style={primaryStyle}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

const backdropStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.5)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 2000,
};

const cardStyle: CSSProperties = {
  backgroundColor: "color-mix(in srgb, var(--bg-1) 86%, transparent)",
  border: "1px solid color-mix(in srgb, var(--fg-0) 14%, transparent)",
  borderRadius: "var(--radius-lg)",
  padding: "var(--space-4)",
  minWidth: 320,
  maxWidth: "min(28rem, 90vw)",
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-3)",
  color: "var(--fg-0)",
  boxShadow:
    "inset 0 1px 0 color-mix(in srgb, white 8%, transparent), var(--shadow-md)",
  backdropFilter: "blur(16px)",
};

const quietStyle: CSSProperties = {
  padding: "var(--space-2) var(--space-3)",
  borderRadius: "var(--radius-md)",
  border: "1px solid transparent",
  background: "transparent",
  color: "var(--fg-muted)",
  cursor: "pointer",
  fontSize: "var(--text-sm)",
};

const primaryStyle: CSSProperties = {
  padding: "var(--space-2) var(--space-3)",
  borderRadius: "var(--radius-md)",
  border: "1px solid color-mix(in srgb, var(--accent-primary, #6366f1) 50%, transparent)",
  background: "color-mix(in srgb, var(--accent-primary, #6366f1) 24%, transparent)",
  color: "var(--fg-0)",
  cursor: "pointer",
  fontSize: "var(--text-sm)",
};
