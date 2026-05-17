import { useEffect, useState } from "react";
import type {
  LocalModelTelemetry,
  TelemetryStream,
} from "./LocalModelStatus.types";

interface LocalModelStatusProps {
  stream: TelemetryStream | null;
}

export function LocalModelStatus({ stream }: LocalModelStatusProps): JSX.Element {
  const [sample, setSample] = useState<LocalModelTelemetry | null>(null);

  useEffect(() => {
    if (!stream) {
      setSample(null);
      return;
    }
    const unsub = stream.subscribe(setSample);
    return unsub;
  }, [stream]);

  if (!stream) {
    return (
      <div
        data-testid="local-model-status"
        data-state="muted"
        role="status"
        aria-live="polite"
        style={{
          padding: "var(--space-4)",
          backgroundColor: "var(--bg-elevated)",
          color: "var(--fg-muted)",
          borderRadius: "var(--radius-lg)",
          fontSize: "var(--text-sm)",
        }}
      >
        Telemetry unavailable - waiting for sidecar.
      </div>
    );
  }

  if (!sample) {
    return (
      <div
        data-testid="local-model-status"
        data-state="loading"
        role="status"
        aria-live="polite"
        style={{
          padding: "var(--space-4)",
          backgroundColor: "var(--bg-elevated)",
          color: "var(--fg-muted)",
          borderRadius: "var(--radius-lg)",
          fontSize: "var(--text-sm)",
        }}
      >
        Connecting to local model...
      </div>
    );
  }

  const pct = Math.min(100, Math.max(0, sample.gpuPct));
  const barColor =
    pct > 85 ? "var(--status-err)" : pct > 70 ? "var(--status-warn)" : "var(--status-ok)";

  return (
    <div
      data-testid="local-model-status"
      data-state="active"
      role="status"
      aria-live="polite"
      style={{
        padding: "var(--space-4)",
        backgroundColor: "var(--bg-elevated)",
        color: "var(--fg-0)",
        borderRadius: "var(--radius-lg)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-2)",
        fontSize: "var(--text-sm)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span style={{ fontWeight: 600 }}>
          {sample.modelName} {sample.paramSize}
        </span>
        <span style={{ color: "var(--status-ok)", fontSize: "var(--text-xs)" }}>Active</span>
      </div>

      <div
        aria-label={`GPU utilization ${pct}%`}
        style={{
          height: 8,
          width: "100%",
          backgroundColor: "var(--bg-2)",
          borderRadius: "var(--radius-sm)",
          overflow: "hidden",
        }}
      >
        <div
          data-testid="gpu-bar"
          style={{
            height: "100%",
            width: `${pct}%`,
            backgroundColor: barColor,
            transition: "width 200ms ease-out",
          }}
        />
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: "var(--text-xs)",
          color: "var(--fg-muted)",
        }}
      >
        <span>
          GPU: {pct.toFixed(0)}% - {sample.deviceName}
        </span>
        <span>{sample.vramFreeGB.toFixed(1)} GB free</span>
      </div>
    </div>
  );
}
