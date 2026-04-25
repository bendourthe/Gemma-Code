import type {
  TraceStore,
  Span,
  SpanKind,
  SpanStatus,
} from "./TraceStore.js";

/**
 * Tracer that instruments Gemma-Code components with trace spans.
 * When no TraceStore is configured, all methods are zero-cost no-ops.
 *
 * Constructed once at the composition root (`GemmaRuntime`) and passed by
 * reference to consumers. Tests construct fresh per-test instances rather
 * than relying on shared static state.
 */
export class Tracer {
  private _store: TraceStore | null = null;
  private _exporter: TracerExporter | null = null;

  constructor() {}

  /** Wire the trace store. Pass null to disable tracing. */
  init(store: TraceStore | null): void {
    this._store = store;
  }

  /** Attach an optional exporter (OTLP, etc.). */
  setExporter(exporter: TracerExporter | null): void {
    this._exporter = exporter;
  }

  /** Whether tracing is active (store initialized). */
  get enabled(): boolean {
    return this._store !== null;
  }

  // -------------------------------------------------------------------------
  // Trace lifecycle
  // -------------------------------------------------------------------------

  startTrace(sessionId?: string): string {
    if (!this._store) return "";
    const trace = this._store.startTrace(sessionId);
    return trace.traceId;
  }

  // -------------------------------------------------------------------------
  // Span lifecycle
  // -------------------------------------------------------------------------

  startSpan(
    traceId: string,
    name: string,
    kind: SpanKind,
    parentSpanId?: string,
    attributes?: Record<string, string | number | boolean>,
  ): string {
    if (!this._store || !traceId) return "";
    const span = this._store.startSpan(
      traceId,
      name,
      kind,
      parentSpanId,
      attributes,
    );
    return span.spanId;
  }

  endSpan(
    spanId: string,
    status: SpanStatus,
    attributes?: Record<string, string | number | boolean>,
  ): void {
    if (!this._store || !spanId) return;
    this._store.endSpan(spanId, status, attributes);

    if (this._exporter) {
      const span = this._store.getSpan(spanId);
      if (span) {
        this._exporter.enqueueSpan(span);
      }
    }
  }

  addEvent(
    spanId: string,
    name: string,
    attributes?: Record<string, string | number | boolean>,
  ): void {
    if (!this._store || !spanId) return;
    this._store.addEvent(spanId, {
      name,
      timestamp: Date.now(),
      attributes,
    });
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /** Get the root span ID for a trace. */
  getRootSpanId(traceId: string): string {
    if (!this._store || !traceId) return "";
    const trace = this._store.getTrace(traceId);
    return trace?.rootSpanId ?? "";
  }
}

/**
 * Interface for span exporters (OTLP, etc.).
 * Kept minimal so Tracer does not depend on OtlpExporter directly.
 */
export interface TracerExporter {
  enqueueSpan(span: Span): void;
}
