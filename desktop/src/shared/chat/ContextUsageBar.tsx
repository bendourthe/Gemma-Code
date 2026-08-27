/**
 * v2.2.7 Phase 3 -- pill Context meter under every composer.
 *
 * Left label `Context`, right label `N%`. Hidden when the helper has no
 * honest denominator (null window and no visual budget). Color uses existing
 * status tokens at 80% and 100%.
 */

import type { CSSProperties } from "react";
import type { SessionContextUsage } from "../../../../core/chat/sessionContextUsage";

export interface ContextUsageBarProps {
  readonly usage: SessionContextUsage;
  readonly testId?: string;
}

function fillColor(percent: number): string {
  if (percent >= 100) return "var(--status-err)";
  if (percent >= 80) return "var(--status-warn)";
  return "var(--status-info)";
}

export function ContextUsageBar({
  usage,
  testId = "context-usage-bar",
}: ContextUsageBarProps): JSX.Element | null {
  if (usage.percent === null || usage.denominatorKind === "none") return null;
  const clamped = Math.max(0, usage.percent);
  const display = Math.floor(clamped + 1e-9);
  const kindLabel =
    usage.denominatorKind === "visual"
      ? "Context usage against the visual token budget"
      : "Context usage against the model window";
  const label = usage.estimated ? `${kindLabel} (estimate)` : kindLabel;
  const track: CSSProperties = {
    position: "relative",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    minWidth: "9rem",
    padding: "0.35rem 0.75rem",
    borderRadius: "999px",
    overflow: "hidden",
    border: "1px solid color-mix(in srgb, var(--fg-0) 14%, transparent)",
    background: "color-mix(in srgb, var(--bg-1) 80%, transparent)",
    fontSize: "var(--text-xs)",
    color: "var(--fg-0)",
    // v2.2.9 Phase 1.2 (T002): the Context pill is the WIDE control of the
    // composer footer (~70-75% of the row); the picker trails, bounded.
    flex: "3 1 auto",
  };
  const fill: CSSProperties = {
    position: "absolute",
    inset: 0,
    width: `${Math.min(100, clamped)}%`,
    background: fillColor(clamped),
    opacity: 0.28,
    pointerEvents: "none",
  };
  const text: CSSProperties = { position: "relative", zIndex: 1 };
  return (
    <div
      data-testid={testId}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={display}
      style={track}
    >
      <span style={fill} aria-hidden />
      <span style={text}>Context</span>
      <span data-testid="context-usage-percent" style={text}>
        {display}%
      </span>
    </div>
  );
}
