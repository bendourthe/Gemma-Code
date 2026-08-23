import type { CSSProperties } from "react";

/** Shared structural styles for the Chat and Coding composer surfaces. */
export const composerSurfaceStyle: CSSProperties = {
  position: "relative",
  display: "block",
  backgroundColor: "var(--bg-0)",
  border: "1px solid var(--border-subtle, #2a2a2a)",
  borderRadius: "var(--radius-lg, 12px)",
};

export const rightControlsStyle: CSSProperties = {
  position: "absolute",
  right: 8,
  bottom: 6,
  display: "flex",
  alignItems: "center",
  gap: "var(--space-1, 4px)",
};

export const clusterIconStyle: CSSProperties = {
  width: 32,
  height: 32,
  padding: 0,
  fontSize: "var(--text-lg)",
  lineHeight: 1,
  borderRadius: "var(--radius-md)",
  border: "none",
  background: "transparent",
  color: "var(--fg-muted, #999)",
  cursor: "pointer",
};

export const docChipStyle: CSSProperties = {
  width: 64,
  height: 64,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--border-1)",
  background: "var(--bg-2)",
  color: "var(--fg-muted)",
  fontSize: "var(--text-xs)",
  fontWeight: 600,
};

export const removeBtnStyle: CSSProperties = {
  position: "absolute",
  top: -6,
  right: -6,
  width: 18,
  height: 18,
  borderRadius: "50%",
  border: "none",
  background: "var(--bg-deep, #000)",
  color: "var(--fg-0)",
  cursor: "pointer",
  fontSize: 11,
  lineHeight: "18px",
  padding: 0,
};
