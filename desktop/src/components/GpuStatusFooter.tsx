/**
 * v2.2.0 Phase 6 (6.2) -- GPU status at the foot of the sidebar.
 *
 * Replaces `LocalModelStatusDock`, which was `position: fixed` at the
 * bottom-right of every route. That dock sat directly on top of the Send and
 * Generate buttons, so the status readout was actively costing the user access
 * to the controls it floated above.
 *
 * Two variants: a compact card in the expanded rail, and a slim utilization
 * mark in the icon rail. Both read the same telemetry stream that Phase 2.4
 * made real, and both render an honest "unavailable" state rather than the
 * fabricated numbers the pre-v2.2.0 mock produced.
 */

import { memo, useEffect, useState } from "react";

import type { LocalModelTelemetry, TelemetryStream } from "./LocalModelStatus.types";

export interface GpuStatusFooterProps {
  compact: boolean;
  stream: TelemetryStream | null;
  testId?: string;
}

/** A sample older than this is shown as stale rather than as current. */
const STALE_AFTER_MS = 15_000;

function barColor(pct: number): string {
  if (pct > 85) return "var(--status-err)";
  if (pct > 70) return "var(--status-warn)";
  return "var(--status-ok)";
}

function GpuStatusFooterInner({
  compact,
  stream,
  testId = "gpu-status-footer",
}: GpuStatusFooterProps): JSX.Element {
  const [sample, setSample] = useState<LocalModelTelemetry | null>(null);

  useEffect(() => {
    if (!stream) return;
    return stream.subscribe(setSample);
  }, [stream]);

  if (!sample) {
    return (
      <div
        data-testid={testId}
        data-state="unavailable"
        title="No GPU telemetry"
        style={{
          padding: compact ? "var(--space-1)" : "var(--space-2)",
          color: "var(--fg-muted)",
          fontSize: "var(--text-xs)",
          textAlign: compact ? "center" : "left",
        }}
      >
        {compact ? "--" : "GPU: unavailable"}
      </div>
    );
  }

  const pct = Math.min(100, Math.max(0, sample.gpuPct));
  const stale =
    typeof sample.lastUpdated === "number" && Date.now() - sample.lastUpdated > STALE_AFTER_MS;
  const headline = sample.idle ? "Idle" : `${sample.modelName} ${sample.paramSize}`.trim();
  const tooltip = [
    `Device: ${sample.deviceName}`,
    `GPU: ${pct.toFixed(0)}%`,
    `Free VRAM: ${sample.vramFreeGB.toFixed(1)} GB`,
    stale ? "Telemetry is stale" : null,
  ]
    .filter(Boolean)
    .join("\n");

  if (compact) {
    // Icon-rail variant: a vertical utilization mark. The tooltip carries the
    // numbers so the rail stays 56px wide.
    return (
      <div
        data-testid={testId}
        data-state={stale ? "stale" : "active"}
        title={tooltip}
        role="status"
        aria-label={`GPU ${pct.toFixed(0)} percent, ${sample.vramFreeGB.toFixed(1)} GB free`}
        style={{ display: "flex", justifyContent: "center", padding: "var(--space-1)" }}
      >
        <div
          style={{
            width: 6,
            height: 32,
            borderRadius: 3,
            background: "var(--bg-2)",
            display: "flex",
            alignItems: "flex-end",
            overflow: "hidden",
          }}
        >
          <div style={{ width: "100%", height: `${pct}%`, background: barColor(pct) }} />
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid={testId}
      data-state={stale ? "stale" : "active"}
      title={tooltip}
      role="status"
      aria-live="polite"
      style={{
        padding: "var(--space-2)",
        borderRadius: "var(--radius-md)",
        backgroundColor: "var(--bg-elevated)",
        border: "1px solid var(--border-subtle)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-1)",
        fontSize: "var(--text-xs)",
      }}
    >
      {/* v2.4.8 Phase 8: no headline row while idle; the card is bar + one
          line of numbers. The model row appears only while a model is loaded,
          and the stale marker keeps its own row only when there is a headline
          to share it with. */}
      {!sample.idle || stale ? (
        <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-2)" }}>
          {!sample.idle ? (
            <span
              data-testid={`${testId}-headline`}
              style={{ color: "var(--fg-0)", overflow: "hidden", textOverflow: "ellipsis" }}
            >
              {headline}
            </span>
          ) : null}
          {stale ? (
            <span data-testid={`${testId}-stale`} style={{ color: "var(--fg-muted)" }}>
              stale
            </span>
          ) : null}
        </div>
      ) : null}
      <div style={{ height: 4, borderRadius: 2, background: "var(--bg-2)", overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: barColor(pct) }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", color: "var(--fg-muted)" }}>
        <span>GPU usage {pct.toFixed(0)}%</span>
        <span>{sample.vramFreeGB.toFixed(1)} GB free</span>
      </div>
    </div>
  );
}

/**
 * Memoized: telemetry ticks about every two seconds, and without this the
 * whole sidebar (nav, admin entries, bell) would re-render on each one.
 */
export const GpuStatusFooter = memo(GpuStatusFooterInner);
