/**
 * v2.2.0 Phase 2 (2.2) -- the one banner every surface shows when the Nexus
 * backend (Node sidecar) is not answering, with a Restart action and a
 * copy-diagnostics affordance.
 *
 * Deliberately plain-language: the user sees "the backend could not start",
 * never the raw `sidecar-not-running` token, while the diagnostic detail stays
 * one click away for a bug report.
 */

import { useState } from "react";

import { describeSidecarFailure, type SidecarStatus } from "../lib/sidecarStatus";

export interface SidecarDownBannerProps {
  status: SidecarStatus | null;
  restarting: boolean;
  restartError: string | null;
  onRestart: () => void;
  /** Optional context line, e.g. "Image models cannot be listed." */
  context?: string;
  testId?: string;
}

export function SidecarDownBanner({
  status,
  restarting,
  restartError,
  onRestart,
  context,
  testId = "sidecar-down-banner",
}: SidecarDownBannerProps) {
  const [showDetail, setShowDetail] = useState(false);
  const detail = describeSidecarFailure(status);

  return (
    <div
      data-testid={testId}
      role="alert"
      style={{
        border: "1px solid var(--status-error, #c0392b)",
        borderRadius: "var(--radius-md, 8px)",
        background: "var(--bg-elevated, #1b1b1b)",
        padding: "var(--space-4, 12px)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-2, 6px)",
      }}
    >
      <strong style={{ color: "var(--status-error, #c0392b)" }}>
        The Nexus backend could not start
      </strong>
      <span style={{ color: "var(--fg-1, #ccc)" }}>
        {context
          ? `${context} This is a backend problem, not a missing download.`
          : "This is a backend problem, not a missing download."}
      </span>
      <div style={{ display: "flex", gap: "var(--space-2, 6px)", flexWrap: "wrap" }}>
        <button
          type="button"
          data-testid={`${testId}-restart`}
          onClick={onRestart}
          disabled={restarting}
          style={{ cursor: restarting ? "progress" : "pointer" }}
        >
          {restarting ? "Restarting..." : "Restart backend"}
        </button>
        <button
          type="button"
          data-testid={`${testId}-details`}
          onClick={() => setShowDetail((v) => !v)}
          style={{ cursor: "pointer" }}
        >
          {showDetail ? "Hide details" : "Show details"}
        </button>
      </div>
      {restartError !== null && (
        <span data-testid={`${testId}-restart-error`} style={{ color: "var(--status-error, #c0392b)" }}>
          Restart failed: {restartError}
        </span>
      )}
      {showDetail && (
        <code
          data-testid={`${testId}-detail`}
          style={{
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            fontSize: "var(--text-xs, 12px)",
            color: "var(--fg-muted, #999)",
          }}
        >
          {detail}
        </code>
      )}
    </div>
  );
}

export interface CatalogFailedBannerProps {
  /** The `catalog-load-failed: <reason>` status from `models.list`. */
  catalogStatus: string;
  testId?: string;
}

/**
 * The backend is healthy but its model catalog did not load -- models on disk
 * may still be listed (synthesized from the probe) with reduced metadata.
 */
export function CatalogFailedBanner({
  catalogStatus,
  testId = "catalog-failed-banner",
}: CatalogFailedBannerProps) {
  return (
    <div
      data-testid={testId}
      role="alert"
      style={{
        border: "1px solid var(--status-warning, #d68910)",
        borderRadius: "var(--radius-md, 8px)",
        background: "var(--bg-elevated, #1b1b1b)",
        padding: "var(--space-4, 12px)",
        color: "var(--fg-1, #ccc)",
      }}
    >
      <strong style={{ color: "var(--status-warning, #d68910)" }}>
        The model catalog could not be loaded
      </strong>
      <div style={{ fontSize: "var(--text-xs, 12px)", color: "var(--fg-muted, #999)" }}>
        {catalogStatus}
      </div>
      <div>Installed models may show with limited details until this is repaired.</div>
    </div>
  );
}
