/**
 * v1.16.0 Phase 2.2 (adoption item A2) -- per-model performance analytics.
 *
 * Renders the rollup the sidecar's `metrics.inference` IPC returns: per model,
 * average tokens/sec, median time-to-first-token, request count, total tokens,
 * and the last resident-memory reading. Sits inside the Traces panel above the
 * per-request event list, which already existed.
 *
 * A missing metric renders as an em dash, never as `0`. A backend that reports
 * no token counts genuinely has none, and showing a zero would read as "this
 * model produced nothing" rather than "this runtime does not report counts".
 * `tokenSource` drives the "estimated" marker so a reader knows which numbers
 * came from the backend and which Nexus derived locally.
 */

import type { PerModelMetricSummaryT } from "../../../../sidecar/src/protocol";

export interface ModelAnalyticsSectionProps {
  perModel: readonly PerModelMetricSummaryT[];
}

export function ModelAnalyticsSection({ perModel }: ModelAnalyticsSectionProps): JSX.Element {
  return (
    <section
      data-testid="trace-model-analytics"
      aria-label="Per-model performance analytics"
      style={{ marginBottom: "var(--space-3)" }}
    >
      <header style={{ fontWeight: 600, marginBottom: "var(--space-2)" }}>
        Per-model performance
      </header>

      {perModel.length === 0 ? (
        <p data-testid="trace-model-analytics-empty" style={{ color: "var(--fg-muted)" }}>
          No inference recorded yet. Run a chat or a local API request and per-model
          tokens/sec, time-to-first-token, and memory will appear here.
        </p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table
            data-testid="trace-model-analytics-table"
            style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.875rem" }}
          >
            <thead>
              <tr style={{ textAlign: "left", color: "var(--fg-muted)" }}>
                <th style={cellStyle}>Model</th>
                <th style={numCellStyle}>Requests</th>
                <th style={numCellStyle}>Avg tokens/sec</th>
                <th style={numCellStyle}>Median TTFT</th>
                <th style={numCellStyle}>Total tokens</th>
                <th style={numCellStyle}>Memory</th>
              </tr>
            </thead>
            <tbody>
              {perModel.map((m) => (
                <tr key={m.model} data-testid={`trace-model-row-${m.model}`}>
                  <td style={{ ...cellStyle, fontFamily: "var(--font-mono)" }}>
                    {m.model}
                    {m.allCountsReported ? null : (
                      <span
                        data-testid={`trace-model-estimated-${m.model}`}
                        title="Some token counts were estimated locally because the runtime did not report them"
                        style={estimatedBadgeStyle}
                      >
                        est
                      </span>
                    )}
                  </td>
                  <td style={numCellStyle}>{m.requestCount}</td>
                  <td style={numCellStyle}>{formatRate(m.avgTokensPerSec)}</td>
                  <td style={numCellStyle}>{formatMs(m.medianTtftMs)}</td>
                  <td style={numCellStyle}>{m.totalTokens > 0 ? m.totalTokens : EM_DASH}</td>
                  <td style={numCellStyle}>{formatBytes(m.lastMemoryBytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

const EM_DASH = "—";

/** Tokens/sec to one decimal. Null (no token counts) renders as an em dash. */
export function formatRate(value: number | null): string {
  if (value === null) return EM_DASH;
  return `${value.toFixed(1)}`;
}

/** Milliseconds, promoted to seconds past 1000ms so the column stays narrow. */
export function formatMs(value: number | null): string {
  if (value === null) return EM_DASH;
  if (value >= 1000) return `${(value / 1000).toFixed(2)} s`;
  return `${Math.round(value)} ms`;
}

/** Binary byte units. Null (backend reports no footprint) renders as an em dash. */
export function formatBytes(value: number | null): string {
  if (value === null) return EM_DASH;
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let n = value;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

const cellStyle: React.CSSProperties = {
  padding: "var(--space-1) var(--space-2)",
  borderBottom: "1px solid var(--border-1)",
};

const numCellStyle: React.CSSProperties = {
  ...cellStyle,
  textAlign: "right",
  fontVariantNumeric: "tabular-nums",
};

const estimatedBadgeStyle: React.CSSProperties = {
  marginLeft: "var(--space-1)",
  padding: "0 var(--space-1)",
  border: "1px solid var(--border-1)",
  borderRadius: "4px",
  fontSize: "0.7rem",
  color: "var(--fg-muted)",
  fontFamily: "var(--font-sans)",
};
