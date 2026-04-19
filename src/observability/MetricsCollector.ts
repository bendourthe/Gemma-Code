import type { TraceStore, Span } from "./TraceStore.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SessionMetrics {
  readonly totalDurationMs: number;
  readonly toolStepCount: number;
  readonly llmCallCount: number;
  readonly retryCount: number;
  readonly compactionCount: number;
  readonly humanInterventionCount: number;
  readonly successRate: number;
  readonly estimatedTokensUsed: number;
  readonly subAgentCount: number;
}

export interface AggregateMetrics {
  readonly averageDurationMs: number;
  readonly medianDurationMs: number;
  readonly averageToolSteps: number;
  readonly averageRetries: number;
  readonly overallSuccessRate: number;
  readonly totalCompactions: number;
  readonly humanInterventionRate: number;
}

export interface MetricsTrend {
  readonly traceIds: readonly string[];
  readonly durations: readonly number[];
  readonly toolSteps: readonly number[];
  readonly successRates: readonly number[];
  readonly compactions: readonly number[];
}

// ---------------------------------------------------------------------------
// MetricsCollector
// ---------------------------------------------------------------------------

export class MetricsCollector {
  constructor(private readonly _store: TraceStore) {}

  computeSessionMetrics(traceId: string): SessionMetrics | null {
    const trace = this._store.getTrace(traceId);
    if (!trace) return null;

    const { spans } = trace;
    const rootSpan = spans.find((s) => s.spanId === trace.rootSpanId);
    const totalDurationMs = rootSpan?.durationMs ?? this._computeDuration(spans);

    const toolSpans = spans.filter((s) => s.kind === "tool_call");
    const llmSpans = spans.filter((s) => s.kind === "llm_call");
    const reflexionSpans = spans.filter((s) => s.kind === "reflexion");
    const compactionSpans = spans.filter((s) => s.kind === "compaction");
    const subAgentSpans = spans.filter((s) => s.kind === "sub_agent");

    const successfulToolCalls = toolSpans.filter(
      (s) => s.status === "ok" || s.attributes["success"] === true,
    );
    const humanInterventions = toolSpans.filter(
      (s) => s.attributes["confirmation_required"] === true,
    );

    const estimatedTokens = spans.reduce((sum, s) => {
      const tokens = s.attributes["tokens_estimated"];
      return sum + (typeof tokens === "number" ? tokens : 0);
    }, 0);

    return {
      totalDurationMs,
      toolStepCount: toolSpans.length,
      llmCallCount: llmSpans.length,
      retryCount: reflexionSpans.length,
      compactionCount: compactionSpans.length,
      humanInterventionCount: humanInterventions.length,
      successRate:
        toolSpans.length > 0
          ? successfulToolCalls.length / toolSpans.length
          : 1,
      estimatedTokensUsed: estimatedTokens,
      subAgentCount: subAgentSpans.length,
    };
  }

  computeAggregateMetrics(traceIds: readonly string[]): AggregateMetrics {
    // Single GROUP BY query instead of loading each trace's spans and
    // re-parsing every attributes JSON (finding #34). Per-span JSON parse
    // now happens only on detail views (computeSessionMetrics, getTrace).
    const aggregates = this._store.getTraceAggregates(traceIds);

    if (aggregates.length === 0) {
      return {
        averageDurationMs: 0,
        medianDurationMs: 0,
        averageToolSteps: 0,
        averageRetries: 0,
        overallSuccessRate: 0,
        totalCompactions: 0,
        humanInterventionRate: 0,
      };
    }

    const durations = aggregates.map((a) => a.durationMs);
    const sorted = [...durations].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const medianDurationMs =
      sorted.length % 2 === 0
        ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
        : (sorted[mid] ?? 0);

    const totalToolCalls = aggregates.reduce((s, a) => s + a.toolCount, 0);
    const totalInterventions = aggregates.reduce(
      (s, a) => s + a.humanInterventionCount,
      0,
    );
    const successRates = aggregates.map((a) =>
      a.toolCount > 0 ? a.toolSuccessCount / a.toolCount : 1,
    );

    return {
      averageDurationMs: avg(durations),
      medianDurationMs,
      averageToolSteps: avg(aggregates.map((a) => a.toolCount)),
      averageRetries: avg(aggregates.map((a) => a.retryCount)),
      overallSuccessRate: avg(successRates),
      totalCompactions: aggregates.reduce((s, a) => s + a.compactionCount, 0),
      humanInterventionRate:
        totalToolCalls > 0 ? totalInterventions / totalToolCalls : 0,
    };
  }

  getMetricsTrend(lastN: number): MetricsTrend {
    const traces = this._store.listTraces(lastN);
    const traceIds: string[] = [];
    const durations: number[] = [];
    const toolSteps: number[] = [];
    const successRates: number[] = [];
    const compactions: number[] = [];

    for (const trace of traces) {
      const metrics = this.computeSessionMetrics(trace.traceId);
      if (!metrics) continue;
      traceIds.push(trace.traceId);
      durations.push(metrics.totalDurationMs);
      toolSteps.push(metrics.toolStepCount);
      successRates.push(metrics.successRate);
      compactions.push(metrics.compactionCount);
    }

    return { traceIds, durations, toolSteps, successRates, compactions };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private _computeDuration(spans: readonly Span[]): number {
    if (spans.length === 0) return 0;
    const minStart = Math.min(...spans.map((s) => s.startTime));
    const maxEnd = Math.max(
      ...spans.map((s) => s.endTime ?? s.startTime),
    );
    return maxEnd - minStart;
  }
}

function avg(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}
