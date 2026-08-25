/**
 * v2.2.7 Phase 3 -- footer row under the typing area: Context pill, then the
 * model picker, then a non-blocking 80% "Start a new session" suggestion.
 */

import type { ReactNode } from "react";
import type { SessionContextUsage } from "../../../../core/chat/sessionContextUsage";
import { ContextUsageBar } from "./ContextUsageBar";

export interface ComposerContextRowProps {
  readonly usage: SessionContextUsage;
  readonly onStartNewSession?: () => void;
  readonly children: ReactNode;
}

export function ComposerContextRow({
  usage,
  onStartNewSession,
  children,
}: ComposerContextRowProps): JSX.Element {
  const showBar = usage.percent !== null && usage.denominatorKind !== "none";
  return (
    <div data-testid="composer-context-row" style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-3)",
          flexWrap: "wrap",
        }}
      >
        {showBar ? <ContextUsageBar usage={usage} /> : null}
        <div style={{ minWidth: 0, flex: "1 1 auto" }}>{children}</div>
      </div>
      {usage.atOrAbove80 && onStartNewSession ? (
        <div
          data-testid="context-usage-cta"
          role="status"
          style={{ fontSize: "var(--text-xs)", color: "var(--status-warn)" }}
        >
          This session is at 80% of context. Starting a new session keeps this transcript.
          <button
            type="button"
            data-testid="context-usage-new-session"
            onClick={onStartNewSession}
            style={{
              marginLeft: "var(--space-2)",
              padding: "0.15rem 0.6rem",
              borderRadius: "999px",
              border: "1px solid var(--status-warn)",
              background: "transparent",
              color: "var(--fg-0)",
              cursor: "pointer",
            }}
          >
            Start a new session
          </button>
        </div>
      ) : null}
    </div>
  );
}
