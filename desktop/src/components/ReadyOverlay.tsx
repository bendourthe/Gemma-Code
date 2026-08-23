/**
 * v2.2.2 Phase 1 -- in-app ready overlay (not a second OS window, not a CMD).
 *
 * Sits on the existing shell so the constellation remains visible. Copy is
 * short. Dismiss is owned by `useReadyGate` in App; this component only paints
 * the waiting or failed state.
 */

import type { CSSProperties } from "react";

import { SidecarDownBanner } from "./SidecarDownBanner";
import type { ReadyPhase } from "../lib/readyGate";
import type { SidecarStatus } from "../lib/sidecarStatus";

export interface ReadyOverlayProps {
  phase: ReadyPhase;
  status: SidecarStatus | null;
  restarting: boolean;
  restartError: string | null;
  onRestart: () => void;
}

export function ReadyOverlay({
  phase,
  status,
  restarting,
  restartError,
  onRestart,
}: ReadyOverlayProps): JSX.Element | null {
  if (phase === "ready") return null;

  const copy =
    phase === "catalog" ? "Reading installed models..." : "Starting local backend...";

  return (
    <div
      data-testid="ready-overlay"
      data-ready-phase={phase}
      role="status"
      aria-live="polite"
      aria-busy={phase !== "failed"}
      style={overlayStyle}
    >
      {phase === "failed" ? (
        <div style={{ width: "min(32rem, 90%)" }}>
          <SidecarDownBanner
            status={status}
            restarting={restarting}
            restartError={restartError}
            onRestart={onRestart}
            context="The local backend did not become ready."
            testId="ready-sidecar-down"
          />
        </div>
      ) : (
        <p data-testid="ready-overlay-copy" style={copyStyle}>
          {copy}
        </p>
      )}
    </div>
  );
}

const overlayStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  zIndex: 20,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "color-mix(in srgb, var(--bg-0) 78%, transparent)",
  pointerEvents: "auto",
};

const copyStyle: CSSProperties = {
  margin: 0,
  color: "var(--fg-0)",
  fontSize: "var(--text-md, 16px)",
  letterSpacing: "0.01em",
};
