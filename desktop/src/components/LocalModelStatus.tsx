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
  const [queueOpen, setQueueOpen] = useState(false);

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
  const idle = Boolean(sample.idle);
  const headline = idle ? "Idle" : `${sample.modelName} ${sample.paramSize}`;
  const queue = sample.queuedJobs ?? [];

  const tooltipLines: string[] = [
    `Device: ${sample.deviceName}`,
  ];
  if (typeof sample.vramTotalGB === "number") {
    tooltipLines.push(`Total VRAM: ${sample.vramTotalGB.toFixed(1)} GB`);
  }
  if (typeof sample.vramAllocatedGB === "number") {
    tooltipLines.push(`Allocated VRAM: ${sample.vramAllocatedGB.toFixed(1)} GB`);
  }
  tooltipLines.push(`Free VRAM: ${sample.vramFreeGB.toFixed(1)} GB`);
  tooltipLines.push(`Queued jobs: ${queue.length}`);
  const tooltip = tooltipLines.join("\n");

  return (
    <>
      <button
        type="button"
        data-testid="local-model-status"
        data-state="active"
        data-idle={idle ? "true" : "false"}
        data-queue-depth={String(queue.length)}
        role="status"
        aria-live="polite"
        aria-label={`Local model status: ${headline}, GPU ${pct.toFixed(0)} percent, ${sample.vramFreeGB.toFixed(1)} GB free`}
        title={tooltip}
        onClick={() => setQueueOpen(true)}
        style={{
          textAlign: "left",
          width: "100%",
          padding: "var(--space-4)",
          backgroundColor: "var(--bg-elevated)",
          color: "var(--fg-0)",
          borderRadius: "var(--radius-lg)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-2)",
          fontSize: "var(--text-sm)",
          border: "1px solid var(--border-subtle)",
          cursor: "pointer",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span style={{ fontWeight: 600 }}>{headline}</span>
          <span
            style={{
              color: idle ? "var(--fg-muted)" : "var(--status-ok)",
              fontSize: "var(--text-xs)",
            }}
          >
            {idle ? "Idle" : "Active"}
          </span>
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
      </button>

      {queueOpen ? (
        <QueueModal
          queue={queue}
          activeModel={idle ? null : headline}
          onClose={() => setQueueOpen(false)}
        />
      ) : null}
    </>
  );
}

interface QueueModalProps {
  queue: ReadonlyArray<{
    id: string;
    moduleId: string;
    jobType: string;
    modelId?: string;
    estimatedVramGB?: number;
  }>;
  activeModel: string | null;
  onClose: () => void;
}

function QueueModal({ queue, activeModel, onClose }: QueueModalProps): JSX.Element {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="GPU scheduler queue"
      data-testid="local-model-queue-modal"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--bg-elevated)",
          color: "var(--fg-0)",
          padding: "var(--space-5)",
          borderRadius: "var(--radius-lg)",
          minWidth: 360,
          maxWidth: "80vw",
          maxHeight: "80vh",
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-3)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <h2 style={{ margin: 0, fontSize: "var(--text-md)" }}>GPU scheduler queue</h2>
          <button
            type="button"
            data-testid="local-model-queue-close"
            onClick={onClose}
            style={{
              background: "transparent",
              color: "var(--fg-1)",
              border: "1px solid var(--border-subtle)",
              borderRadius: "var(--radius-md)",
              padding: "var(--space-1) var(--space-3)",
            }}
          >
            Close
          </button>
        </div>
        <div style={{ fontSize: "var(--text-sm)", color: "var(--fg-muted)" }}>
          Active: {activeModel ?? "Idle"}
        </div>
        {queue.length === 0 ? (
          <div
            data-testid="local-model-queue-empty"
            style={{ fontSize: "var(--text-sm)", color: "var(--fg-muted)" }}
          >
            No queued jobs.
          </div>
        ) : (
          <ul
            data-testid="local-model-queue-list"
            style={{
              listStyle: "none",
              padding: 0,
              margin: 0,
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-2)",
            }}
          >
            {queue.map((entry) => (
              <li
                key={entry.id}
                data-testid={`queue-entry-${entry.id}`}
                style={{
                  display: "grid",
                  gridTemplateColumns: "auto 1fr auto",
                  gap: "var(--space-3)",
                  fontSize: "var(--text-sm)",
                  padding: "var(--space-2) var(--space-3)",
                  background: "var(--bg-1)",
                  borderRadius: "var(--radius-md)",
                }}
              >
                <span style={{ color: "var(--fg-muted)" }}>{entry.moduleId}</span>
                <span>{entry.jobType}</span>
                <span style={{ color: "var(--fg-muted)" }}>
                  {typeof entry.estimatedVramGB === "number"
                    ? `${entry.estimatedVramGB.toFixed(1)} GB`
                    : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
