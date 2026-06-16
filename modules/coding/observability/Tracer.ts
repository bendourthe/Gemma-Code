import type {
  TraceStore,
  Span,
  SpanKind,
  SpanNesting,
  SpanStatus,
} from "./TraceStore.js";

/**
 * v1.0.0 Phase 10.5 -- skill provenance attached to a trace span.
 *
 * The Tracer keeps an optional "current skill" context. When a `tool_call`
 * span starts while a skill is active, the provenance fields are flattened
 * into the span attributes so the dashboard and `/trace dump` JSON can
 * render "Skill: devai-hub@v1.3.2/<name>". The flattening is intentional:
 * the TraceStore attributes column only carries `string | number | boolean`
 * values so we can't store a nested object directly.
 */
export interface SkillSpanContext {
  /** Canonical skill id, namespaced for non-builtin sources (e.g. `devai-hub/code-quality`). */
  readonly id: string;
  /** `builtin` | `user` | `devai-hub`. Matches `SkillProvenance.source`. */
  readonly namespace: "builtin" | "user" | "devai-hub";
  /** Provenance tag (e.g. `v1.3.2`) for devai-hub sourced skills. */
  readonly tag?: string;
  /** SHA-256 over the SKILL.md body and any bundled scripts. */
  readonly contentHash?: string;
}

/**
 * Flatten a skill context into the attribute keys the TraceStore can persist.
 * Exported for downstream consumers (the trace dashboard's detail view) so
 * they can reconstruct the nested shape from a raw attributes record.
 */
export function skillContextAttributes(
  skill: SkillSpanContext,
): Record<string, string> {
  const out: Record<string, string> = {
    "skill.id": skill.id,
    "skill.namespace": skill.namespace,
  };
  if (skill.tag) out["skill.tag"] = skill.tag;
  if (skill.contentHash) out["skill.contentHash"] = skill.contentHash;
  return out;
}

/**
 * Reconstruct a `SkillSpanContext` from a flattened attribute record. Returns
 * `null` when the record does not include any `skill.*` keys.
 */
export function readSkillContextFromAttributes(
  attributes: Record<string, string | number | boolean>,
): SkillSpanContext | null {
  const id = attributes["skill.id"];
  const ns = attributes["skill.namespace"];
  if (typeof id !== "string" || typeof ns !== "string") return null;
  if (ns !== "builtin" && ns !== "user" && ns !== "devai-hub") return null;
  const ctx: SkillSpanContext = {
    id,
    namespace: ns,
    tag: typeof attributes["skill.tag"] === "string" ? (attributes["skill.tag"] as string) : undefined,
    contentHash:
      typeof attributes["skill.contentHash"] === "string"
        ? (attributes["skill.contentHash"] as string)
        : undefined,
  };
  return ctx;
}

/**
 * Tracer that instruments Gemma-Code components with trace spans.
 * When no TraceStore is configured, all methods are zero-cost no-ops.
 *
 * Constructed once at the composition root (`NexusCodingRuntime`) and passed by
 * reference to consumers. Tests construct fresh per-test instances rather
 * than relying on shared static state.
 */
export class Tracer {
  private _store: TraceStore | null = null;
  private _exporter: TracerExporter | null = null;
  private _currentSkill: SkillSpanContext | null = null;

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
  // v1.0.0 Phase 10.5 -- skill provenance context
  // -------------------------------------------------------------------------

  /**
   * Set or clear the currently-active skill context. While set, every
   * `startSpan` call with kind `tool_call` (or `sub_agent`) gets the skill
   * provenance attributes folded in automatically. Pass `null` to clear.
   */
  setCurrentSkill(skill: SkillSpanContext | null): void {
    this._currentSkill = skill;
  }

  /** Currently-active skill context, if any. */
  get currentSkill(): SkillSpanContext | null {
    return this._currentSkill;
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
    nesting?: SpanNesting,
  ): string {
    if (!this._store || !traceId) return "";
    const merged = this._mergeSkillContext(kind, attributes);
    const span = this._store.startSpan(
      traceId,
      name,
      kind,
      parentSpanId,
      merged,
      nesting,
    );
    return span.spanId;
  }

  private _mergeSkillContext(
    kind: SpanKind,
    attributes?: Record<string, string | number | boolean>,
  ): Record<string, string | number | boolean> | undefined {
    if (!this._currentSkill) return attributes;
    if (kind !== "tool_call" && kind !== "sub_agent") return attributes;
    return { ...(attributes ?? {}), ...skillContextAttributes(this._currentSkill) };
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
