/**
 * v1.0.0 Phase 4.3 -- folder breadcrumb.
 *
 * Renders the active chat's folder path. Root chats show `/` alone.
 */

import type { Folder } from "./types";

export interface BreadcrumbProps {
  ancestors: readonly Folder[];
  /** Optional callback when an ancestor crumb is clicked. */
  onNavigate?: (folder: Folder | null) => void;
}

export function Breadcrumb({ ancestors, onNavigate }: BreadcrumbProps): JSX.Element {
  return (
    <nav
      data-testid="chat-breadcrumb"
      aria-label="Folder breadcrumb"
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-1)",
        fontSize: "var(--text-sm)",
        color: "var(--fg-muted)",
      }}
    >
      <button
        type="button"
        data-testid="chat-breadcrumb-root"
        onClick={() => onNavigate?.(null)}
        style={crumbButtonStyle}
      >
        /
      </button>
      {ancestors.map((folder, idx) => (
        <span key={folder.id} style={{ display: "flex", gap: "var(--space-1)" }}>
          <span aria-hidden>&gt;</span>
          <button
            type="button"
            data-testid={`chat-breadcrumb-${folder.id}`}
            onClick={() => onNavigate?.(folder)}
            style={{
              ...crumbButtonStyle,
              color: idx === ancestors.length - 1 ? "var(--fg-0)" : "var(--fg-muted)",
            }}
          >
            {folder.name}
          </button>
        </span>
      ))}
    </nav>
  );
}

const crumbButtonStyle = {
  background: "transparent",
  border: "none",
  color: "var(--fg-muted)",
  cursor: "pointer",
  padding: 0,
  fontSize: "inherit",
} as const;
