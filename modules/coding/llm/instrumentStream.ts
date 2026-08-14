/**
 * v1.16.0 Phase 2.1 (adoption item A2) -- inference-metric capture at the
 * LLM-client boundary.
 *
 * One transparent wrapper around an `LLMClient.streamChat` generator, applied by
 * all four client factories (`OllamaClient`, `LmStudioClient`, and the two
 * headless variants). Wrapping at the client rather than at each call site is
 * what makes this a ~4-line change per client instead of an 18-call-site sweep:
 * every consumer (AgentLoop, StreamingPipeline, the panel agents, the chat
 * handler, the v1.16.0 serving gateway) is instrumented at once.
 *
 * Transparency is the contract. The wrapper yields exactly the chunks it
 * receives, in order, and re-throws exactly what the inner generator throws --
 * a metrics failure must never change what a caller sees. Recording happens in a
 * `finally`, so a cancelled or failed stream still reports the partial timing it
 * did observe.
 *
 * This module bridges `modules/**` to `core/**` (the allowed direction): it
 * knows the `LLMStreamChunk` wire shape, converts it to plain numbers, and hands
 * those to `core/observability/InferenceMetrics.ts`.
 */

import {
  type InferenceMetricRecord,
  type InferenceMetricsRegistry,
  type TokenSource,
  deriveTokensPerSec,
  nsToMs,
  sharedInferenceMetrics,
} from "../../../core/observability/InferenceMetrics.js";
import { tokenize } from "../../../core/observability/TokenCost.js";
import type { LLMStreamChunk } from "./types.js";

/** Best-effort resident-memory probe (Ollama `/api/ps`). Must never throw. */
export type MemoryProbe = () => number | null;

export interface InstrumentStreamOptions {
  /** Model id as the caller requested it. */
  readonly model: string;
  /** Runtime that served the request (`ollama`, `lmstudio`, a manifest name). */
  readonly adapter?: string;
  /** Defaults to the process-wide registry. */
  readonly registry?: InferenceMetricsRegistry;
  /** Injected for deterministic tests. Defaults to `performance.now()`. */
  readonly now?: () => number;
  /** Injected for deterministic tests. Defaults to `Date.now()`. */
  readonly wallClock?: () => number;
  /** Synchronous, cached memory reading; see `ollamaMemory.ts`. */
  readonly memoryProbe?: MemoryProbe;
  /**
   * When the backend reports no token counts, estimate completion tokens from
   * the accumulated text so tokens/sec is still available (marked `estimated`).
   * Defaults to true; the estimate uses the repo's existing `tokenize` heuristic.
   */
  readonly estimateWhenMissing?: boolean;
}

/** Counters observed across a stream; the final chunk usually carries them. */
interface ObservedCounters {
  promptTokens: number | null;
  completionTokens: number | null;
  evalDurationNs: number | null;
  totalDurationNs: number | null;
  reported: boolean;
}

function readCounters(chunk: LLMStreamChunk, into: ObservedCounters): void {
  // Ollama shape (final chunk of /api/chat).
  if (typeof chunk.prompt_eval_count === "number") {
    into.promptTokens = chunk.prompt_eval_count;
    into.reported = true;
  }
  if (typeof chunk.eval_count === "number") {
    into.completionTokens = chunk.eval_count;
    into.reported = true;
  }
  if (typeof chunk.eval_duration === "number") into.evalDurationNs = chunk.eval_duration;
  if (typeof chunk.total_duration === "number") into.totalDurationNs = chunk.total_duration;

  // OpenAI-compatible shape (LM Studio and friends, when they send usage).
  const usage = chunk.usage;
  if (usage) {
    if (typeof usage.prompt_tokens === "number") {
      into.promptTokens = usage.prompt_tokens;
      into.reported = true;
    }
    if (typeof usage.completion_tokens === "number") {
      into.completionTokens = usage.completion_tokens;
      into.reported = true;
    }
  }
}

/**
 * Wrap a chat stream, recording one metric per completed request.
 *
 * TTFT is measured to the first chunk carrying non-empty content, not to the
 * first chunk of any kind: an opening role-only delta is not a token the user
 * can see, and counting it would flatter the number.
 */
export async function* instrumentStream(
  source: AsyncGenerator<LLMStreamChunk>,
  opts: InstrumentStreamOptions,
): AsyncGenerator<LLMStreamChunk> {
  const now = opts.now ?? (() => performance.now());
  const wallClock = opts.wallClock ?? (() => Date.now());
  const registry = opts.registry ?? sharedInferenceMetrics();
  const estimate = opts.estimateWhenMissing !== false;

  const startedAt = now();
  let ttftMs: number | null = null;
  let text = "";
  const observed: ObservedCounters = {
    promptTokens: null,
    completionTokens: null,
    evalDurationNs: null,
    totalDurationNs: null,
    reported: false,
  };

  try {
    for await (const chunk of source) {
      const content = chunk.message?.content ?? "";
      if (ttftMs === null && content.length > 0) {
        ttftMs = round2(now() - startedAt);
      }
      if (content.length > 0) text += content;
      readCounters(chunk, observed);
      yield chunk;
    }
  } finally {
    const totalMs = round2(now() - startedAt);

    let tokenSource: TokenSource = observed.reported ? "reported" : "unavailable";
    let completionTokens = observed.completionTokens;
    if (!observed.reported && estimate && text.length > 0) {
      completionTokens = tokenize(text);
      tokenSource = "estimated";
    }

    const record: InferenceMetricRecord = {
      model: opts.model,
      adapter: opts.adapter ?? null,
      promptTokens: observed.promptTokens,
      completionTokens,
      tokenSource,
      ttftMs,
      totalMs,
      tokensPerSec: deriveTokensPerSec({
        completionTokens,
        evalDurationNs: observed.evalDurationNs,
        totalMs,
      }),
      memoryBytes: safeProbe(opts.memoryProbe),
      at: wallClock(),
    };
    registry.record(record);
  }
}

function safeProbe(probe: MemoryProbe | undefined): number | null {
  if (!probe) return null;
  try {
    return probe();
  } catch {
    return null;
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Ollama's native duration unit is nanoseconds; re-exported so callers that read
 * counters directly (the serving gateway's usage envelopes) share one converter.
 */
export { nsToMs };
