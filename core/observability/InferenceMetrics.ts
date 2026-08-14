/**
 * v1.16.0 Phase 2.1 (adoption item A2) -- per-model inference metrics.
 *
 * Records one entry per completed LLM request (tokens, time-to-first-token,
 * wall time, derived tokens/sec, memory footprint) and rolls them up per model.
 * Feeds the desktop Traces panel's per-model analytics and, in the VS Code host,
 * the `llm_call` span attributes.
 *
 * Local-only by construction. The registry is an in-process ring buffer: nothing
 * is written to disk and nothing leaves the host. Records reach an OTLP endpoint
 * only if the caller separately attaches them to a trace span AND the user has
 * opted in via `nexus.otlp.enabled` -- this module never exports anything itself.
 *
 * Layering: this lives in `core/` and is deliberately free of any LLM wire type,
 * because `core/**` must not depend on `modules/**` (the `no-core-from-modules`
 * boundary rule). The adapter that knows about `LLMStreamChunk` is
 * `modules/coding/llm/instrumentStream.ts`, which feeds plain numbers in here.
 *
 * Missing data is NEVER a zero. A backend that does not report token counts
 * yields `null`, and `tokenSource` says whether a count was reported by the
 * backend, estimated locally, or is unavailable -- the same "sensor missing"
 * discriminator convention `energyStatus` established in v1.5.0.
 */

import type { TelemetryBus } from "../telemetry/TelemetryBus.js";
import { redactSecrets } from "./redactSecrets.js";

/** Nanoseconds per millisecond -- Ollama reports durations in nanoseconds. */
const NS_PER_MS = 1_000_000;

/** Default ring-buffer depth. Bounded so a long session cannot grow unbounded. */
export const DEFAULT_METRIC_CAPACITY = 500;

/** Where a token count came from. Absent counts stay explicit, never zero. */
export type TokenSource = "reported" | "estimated" | "unavailable";

/** One completed inference request. */
export interface InferenceMetricRecord {
  /** Model id as requested by the caller. */
  readonly model: string;
  /** Which local runtime served it (`ollama`, `lmstudio`, a manifest name). */
  readonly adapter: string | null;
  /** Prompt tokens, or null when the backend reported none. */
  readonly promptTokens: number | null;
  /** Completion tokens, or null when the backend reported none. */
  readonly completionTokens: number | null;
  readonly tokenSource: TokenSource;
  /** Time from request start to the first content token, ms. */
  readonly ttftMs: number | null;
  /** Total wall time for the request, ms. */
  readonly totalMs: number;
  /** Completion tokens per second, or null when tokens are unavailable. */
  readonly tokensPerSec: number | null;
  /** Resident model size in bytes, when the backend reports it. */
  readonly memoryBytes: number | null;
  /** Unix ms when the request completed. */
  readonly at: number;
}

/** Rolled-up view of one model's requests. */
export interface PerModelSummary {
  readonly model: string;
  readonly requestCount: number;
  /** Prompt + completion across all requests that reported counts. */
  readonly totalTokens: number;
  readonly avgTokensPerSec: number | null;
  readonly medianTtftMs: number | null;
  readonly lastMemoryBytes: number | null;
  readonly lastAt: number;
  /** True when every contributing count was backend-reported. */
  readonly allCountsReported: boolean;
}

/**
 * Derive completion tokens per second. Prefers the backend's own generation
 * duration (Ollama's `eval_duration`) over total wall time, because wall time
 * includes model load and queueing and would understate throughput.
 */
export function deriveTokensPerSec(args: {
  completionTokens: number | null;
  evalDurationNs?: number | null;
  totalMs?: number | null;
}): number | null {
  const tokens = args.completionTokens;
  if (tokens === null || tokens <= 0) return null;
  const evalMs =
    args.evalDurationNs !== null && args.evalDurationNs !== undefined && args.evalDurationNs > 0
      ? args.evalDurationNs / NS_PER_MS
      : null;
  const ms = evalMs ?? (args.totalMs !== null && args.totalMs !== undefined && args.totalMs > 0 ? args.totalMs : null);
  if (ms === null) return null;
  return round2((tokens / ms) * 1000);
}

/** Convert a nanosecond duration to milliseconds, preserving null/absent. */
export function nsToMs(ns: number | null | undefined): number | null {
  if (ns === null || ns === undefined || !Number.isFinite(ns)) return null;
  return round2(ns / NS_PER_MS);
}

/** Median of a numeric list; null for an empty list. Does not mutate the input. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const value =
    sorted.length % 2 === 1
      ? (sorted[mid] as number)
      : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
  return round2(value);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Optional publish target so records also flow onto the telemetry bus. */
export interface MetricPublisher {
  publish(record: InferenceMetricRecord): void;
}

/**
 * Adapt the existing `TelemetryBus` into a `MetricPublisher`, so records reach
 * the in-process bus as `model.inference.complete` events instead of needing a
 * new sink.
 *
 * The bus deliberately does NOT buffer -- an event published with no subscriber
 * is dropped -- which is why the registry's own bounded ring buffer, not the bus,
 * is what satisfies "metrics accumulate per model across a session". The bus is
 * the live-push path for anything that wants to react to a completion as it
 * happens; the Traces panel polls the registry instead.
 */
export function createTelemetryMetricPublisher(
  bus: TelemetryBus,
  source = "coding",
): MetricPublisher {
  return {
    publish(record: InferenceMetricRecord): void {
      bus.publish<InferenceMetricRecord>({
        kind: "model.inference.complete",
        source,
        payload: record,
      });
    },
  };
}

export interface InferenceMetricsRegistryOptions {
  readonly capacity?: number;
  readonly publisher?: MetricPublisher;
}

/**
 * Bounded in-memory store of inference records with per-model rollups.
 *
 * `record()` is intentionally total: it never throws, because it runs on the
 * inference hot path and a metrics failure must never break a user's completion.
 */
export class InferenceMetricsRegistry {
  private readonly _capacity: number;
  private readonly _publisher: MetricPublisher | undefined;
  private _records: InferenceMetricRecord[] = [];

  constructor(opts: InferenceMetricsRegistryOptions = {}) {
    this._capacity =
      opts.capacity !== undefined && opts.capacity > 0 ? opts.capacity : DEFAULT_METRIC_CAPACITY;
    this._publisher = opts.publisher;
  }

  get size(): number {
    return this._records.length;
  }

  /**
   * Store one record, dropping the oldest past capacity. The model id is passed
   * through `redactSecrets` because it is the one caller-supplied string here,
   * and a metrics surface must not become a place a secret can surface.
   */
  record(input: InferenceMetricRecord): void {
    try {
      const safe: InferenceMetricRecord = { ...input, model: redactSecrets(input.model) };
      this._records.push(safe);
      if (this._records.length > this._capacity) {
        this._records = this._records.slice(-this._capacity);
      }
      this._publisher?.publish(safe);
    } catch {
      // Metrics must never break inference.
    }
  }

  /** Most recent records first, newest-limited. */
  recent(limit = 50): readonly InferenceMetricRecord[] {
    if (limit <= 0) return [];
    return [...this._records].reverse().slice(0, limit);
  }

  /** Per-model rollup, most recently used model first. */
  perModel(): readonly PerModelSummary[] {
    const byModel = new Map<string, InferenceMetricRecord[]>();
    for (const r of this._records) {
      const list = byModel.get(r.model);
      if (list) list.push(r);
      else byModel.set(r.model, [r]);
    }

    const out: PerModelSummary[] = [];
    for (const [model, records] of byModel) {
      const rates = records
        .map((r) => r.tokensPerSec)
        .filter((v): v is number => v !== null);
      const ttfts = records.map((r) => r.ttftMs).filter((v): v is number => v !== null);
      const totalTokens = records.reduce(
        (acc, r) => acc + (r.promptTokens ?? 0) + (r.completionTokens ?? 0),
        0,
      );
      const withMemory = [...records].reverse().find((r) => r.memoryBytes !== null);
      out.push({
        model,
        requestCount: records.length,
        totalTokens,
        avgTokensPerSec:
          rates.length > 0 ? round2(rates.reduce((a, b) => a + b, 0) / rates.length) : null,
        medianTtftMs: median(ttfts),
        lastMemoryBytes: withMemory?.memoryBytes ?? null,
        lastAt: records.reduce((acc, r) => Math.max(acc, r.at), 0),
        allCountsReported: records.every((r) => r.tokenSource === "reported"),
      });
    }
    return out.sort((a, b) => b.lastAt - a.lastAt);
  }

  /** The newest record for one model, or null. Used for span attributes. */
  lastFor(model: string): InferenceMetricRecord | null {
    const safe = redactSecrets(model);
    for (let i = this._records.length - 1; i >= 0; i -= 1) {
      const r = this._records[i];
      if (r && r.model === safe) return r;
    }
    return null;
  }

  clear(): void {
    this._records = [];
  }
}

/**
 * The process-wide registry. A singleton because the producers (LLM clients deep
 * in the call graph) and the consumers (the metrics IPC handler, the VS Code
 * span writer) have no shared composition root to thread an instance through.
 * Tests construct their own `InferenceMetricsRegistry` instead of touching this.
 */
let _shared: InferenceMetricsRegistry | null = null;

export function sharedInferenceMetrics(): InferenceMetricsRegistry {
  if (!_shared) _shared = new InferenceMetricsRegistry();
  return _shared;
}

/** Test/host seam: replace or reset the shared registry. */
export function setSharedInferenceMetrics(registry: InferenceMetricsRegistry | null): void {
  _shared = registry;
}

/**
 * Flatten a record into trace-span attributes. Only non-null numbers are
 * included, so an absent metric leaves the attribute off entirely rather than
 * asserting a zero that a dashboard would average in.
 */
export function metricSpanAttributes(
  record: InferenceMetricRecord,
): Record<string, string | number | boolean> {
  const attrs: Record<string, string | number | boolean> = {
    inferenceTotalMs: record.totalMs,
    tokenSource: record.tokenSource,
  };
  if (record.adapter !== null) attrs.adapter = record.adapter;
  if (record.promptTokens !== null) attrs.promptTokens = record.promptTokens;
  if (record.completionTokens !== null) attrs.completionTokens = record.completionTokens;
  if (record.ttftMs !== null) attrs.ttftMs = record.ttftMs;
  if (record.tokensPerSec !== null) attrs.tokensPerSec = record.tokensPerSec;
  if (record.memoryBytes !== null) attrs.memoryBytes = record.memoryBytes;
  return attrs;
}
