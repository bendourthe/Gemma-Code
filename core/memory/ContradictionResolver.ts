/**
 * v1.1.0 Phase 9.1 -- opt-in contradiction resolver.
 *
 * Detects pairs of semantic-tier rows whose dense embeddings agree (cosine
 * similarity above a threshold) while their textual content disagrees (BM25-
 * style token Jaccard overlap below a threshold). For each contradicting pair
 * the resolver asks a small local Ollama model to adjudicate: it keeps the
 * winner and marks the loser `superseded_by = winner.id` with a structured
 * `resolution_log` entry. The sweep is gated entirely on the
 * `nexus.memory.consolidation.enabled` Settings key (default `false`); when
 * the gate is off, `sweep()` short-circuits before any LLM call.
 *
 * Adopts agentmemory A4 (see docs/v1.1.0/comparison-agentmemory.md
 * Section 11.3 P2).
 */

import { tokenize as defaultTokenize } from "./stopwords.js";
import type { Embedder } from "./LocalEmbedder.js";

/**
 * Lightweight semantic-tier row used by the contradiction resolver. Mirrors
 * the on-disk shape just enough that adapters wrapping `MemoryStore` /
 * `InMemoryMemoryHub` can project rows into this view without a structural
 * coupling.
 */
export interface SemanticRow {
  readonly id: string;
  readonly text: string;
  /**
   * Optional pre-computed embedding. When omitted, the resolver embeds the
   * text via the injected `Embedder`. Pre-computed vectors must already be
   * L2-normalized to match `LocalEmbedder`'s output contract.
   */
  readonly embedding?: Float32Array;
  /** Already-set supersession edge; rows in this state are skipped. */
  readonly supersededBy?: string | null;
  /** ISO timestamp; older rows are preferred as the "loser" tie-break. */
  readonly createdAt?: string | number;
}

/**
 * Structured record of an adjudication. The resolver appends one
 * `ResolutionLogEntry` to the loser row's `resolution_log` array.
 */
export interface ResolutionLogEntry {
  readonly at: number;
  readonly winnerId: string;
  readonly loserId: string;
  readonly model: string;
  readonly justification: string;
  readonly denseSimilarity: number;
  readonly bm25Overlap: number;
}

/**
 * A detected pair of contradicting semantic-tier rows. The pair is
 * deliberately unordered at detection time; the resolver picks the winner
 * via LLM adjudication.
 */
export interface ContradictionGroup {
  readonly a: SemanticRow;
  readonly b: SemanticRow;
  readonly denseSimilarity: number;
  readonly bm25Overlap: number;
}

/**
 * Persistence port the resolver writes through. The implementation is
 * provided by the sidecar (which wraps `MemoryStore.markSuperseded(...)`)
 * or by the in-memory hub. Tests use an array-backed fake.
 */
export interface SemanticTierProvider {
  /** Return every live semantic-tier row, oldest first preferred. */
  list(): Iterable<SemanticRow> | Promise<Iterable<SemanticRow>>;
  /**
   * Mark `loserId` as superseded by `winnerId` and append `log` to its
   * `resolution_log` array. Implementations decide whether to soft-tombstone
   * or hard-delete the loser; tests assert via the recorded calls.
   */
  markSuperseded(loserId: string, winnerId: string, log: ResolutionLogEntry): Promise<void>;
}

/**
 * Structural interface for a local Ollama chat client. The resolver only
 * needs `chat(prompt) -> string`; the concrete implementation in
 * `desktop/sidecar/` wraps the existing `OllamaClient`. Test doubles record
 * invocations so the "no LLM call when disabled" assertion is trivial.
 */
export interface OllamaChatLike {
  readonly model: string;
  chat(prompt: string): Promise<string>;
  /**
   * Total number of `chat()` calls observed since construction. Optional;
   * test doubles override. Useful for the "no LLM call when disabled"
   * assertion in integration tests.
   */
  readonly invocationCount?: number;
}

export interface ContradictionResolverOptions {
  /**
   * `nexus.memory.consolidation.enabled`. When `false` (default), `sweep()`
   * returns immediately and `resolve()` is a no-op.
   */
  readonly enabled?: boolean;
  /** Dense cosine-similarity threshold. Default 0.85. */
  readonly denseSimilarityThreshold?: number;
  /** BM25-overlap (Jaccard) threshold. Default 0.4. */
  readonly bm25OverlapThreshold?: number;
  /**
   * Minimum text length (in characters) before a row is considered for
   * contradiction detection. Default 20 -- guards against trivial short
   * facts whose Jaccard would be noisy.
   */
  readonly minTextLength?: number;
  /** Injectable clock for deterministic tests. Defaults to `Date.now`. */
  readonly now?: () => number;
  /** Per-sweep candidate cap. Default 500. */
  readonly maxCandidates?: number;
}

export interface ContradictionSweepResult {
  readonly scanned: number;
  readonly groups: number;
  readonly resolved: number;
  readonly llmCalls: number;
}

/**
 * Default thresholds. Exposed as a frozen constant so tests can reference
 * the same values the production wiring uses.
 */
export const DEFAULT_THRESHOLDS = Object.freeze({
  denseSimilarity: 0.85,
  bm25Overlap: 0.4,
  minTextLength: 20,
});

/**
 * Compute Jaccard similarity between the BM25-tokenized term sets of two
 * texts. Returns a value in `[0, 1]`. Empty sides return `0`. Exposed for
 * tests; consumers go through `ContradictionResolver.detect`.
 */
export function bm25Jaccard(a: string, b: string): number {
  const ta = new Set(defaultTokenize(a));
  const tb = new Set(defaultTokenize(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let intersect = 0;
  for (const tok of ta) if (tb.has(tok)) intersect += 1;
  const union = ta.size + tb.size - intersect;
  if (union === 0) return 0;
  return intersect / union;
}

/** Cosine similarity between two L2-normalized vectors. */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < n; i++) dot += (a[i] ?? 0) * (b[i] ?? 0);
  return dot;
}

/** Pretty-printed adjudication prompt body. Exported for fixture tests. */
export function buildAdjudicationPrompt(a: SemanticRow, b: SemanticRow): string {
  return [
    "You are a careful memory-curation assistant. Two semantic-memory entries",
    "appear to contradict each other. Decide which one to KEEP and which to",
    "MARK AS SUPERSEDED. Respond with a single line of compact JSON:",
    "",
    '  {"winner":"A"|"B","justification":"<one sentence>"}',
    "",
    "Entry A (id=" + a.id + "):",
    a.text,
    "",
    "Entry B (id=" + b.id + "):",
    b.text,
    "",
    "Reply with only the JSON object on a single line.",
  ].join("\n");
}

/**
 * Best-effort parse of the LLM verdict. Tolerates surrounding code fences
 * or whitespace. Returns `null` when neither key is recoverable.
 */
export function parseAdjudication(raw: string): {
  winner: "A" | "B";
  justification: string;
} | null {
  if (!raw) return null;
  // Strip markdown code fences if the model wrapped its reply.
  const stripped = raw.replace(/```(?:json)?/gi, "").trim();
  // Locate the first `{` ... `}` block.
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  const slice = stripped.slice(start, end + 1);
  let parsed: unknown;
  try {
    parsed = JSON.parse(slice);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;
  const winner = obj["winner"];
  const justification = obj["justification"];
  if (winner !== "A" && winner !== "B") return null;
  return {
    winner,
    justification: typeof justification === "string" ? justification : "",
  };
}

export class ContradictionResolver {
  private readonly _embedder: Embedder;
  private readonly _provider: SemanticTierProvider;
  private readonly _ollama: OllamaChatLike;
  private readonly _enabled: boolean;
  private readonly _denseThreshold: number;
  private readonly _bm25Threshold: number;
  private readonly _minTextLength: number;
  private readonly _now: () => number;
  private readonly _maxCandidates: number;

  constructor(args: {
    readonly embedder: Embedder;
    readonly provider: SemanticTierProvider;
    readonly ollama: OllamaChatLike;
    readonly options?: ContradictionResolverOptions;
  }) {
    const opts = args.options ?? {};
    this._embedder = args.embedder;
    this._provider = args.provider;
    this._ollama = args.ollama;
    this._enabled = opts.enabled ?? false;
    this._denseThreshold =
      opts.denseSimilarityThreshold ?? DEFAULT_THRESHOLDS.denseSimilarity;
    this._bm25Threshold = opts.bm25OverlapThreshold ?? DEFAULT_THRESHOLDS.bm25Overlap;
    this._minTextLength = opts.minTextLength ?? DEFAULT_THRESHOLDS.minTextLength;
    this._now = opts.now ?? Date.now;
    this._maxCandidates = opts.maxCandidates ?? 500;
  }

  /** Whether the consolidation toggle is on. Read by the IdleTimeScheduler binding. */
  get enabled(): boolean {
    return this._enabled;
  }

  /**
   * Compare `entry` against every other live semantic-tier row and return
   * the pairs that satisfy the contradiction predicate. Pure detection: no
   * mutation, no LLM call. Always safe to invoke regardless of the
   * `enabled` toggle.
   */
  async detect(entry: SemanticRow): Promise<ContradictionGroup[]> {
    if (!entry.text || entry.text.length < this._minTextLength) return [];
    const entryVec = entry.embedding ?? (await this._embedder.embed(entry.text));
    const groups: ContradictionGroup[] = [];
    const seen = new Set<string>();
    seen.add(entry.id);
    for (const candidate of await this._listSnapshot()) {
      if (seen.has(candidate.id)) continue;
      seen.add(candidate.id);
      if (candidate.supersededBy) continue;
      if (!candidate.text || candidate.text.length < this._minTextLength) continue;
      const candVec =
        candidate.embedding ?? (await this._embedder.embed(candidate.text));
      const dense = cosineSimilarity(entryVec, candVec);
      if (dense <= this._denseThreshold) continue;
      const overlap = bm25Jaccard(entry.text, candidate.text);
      if (overlap >= this._bm25Threshold) continue;
      groups.push({ a: entry, b: candidate, denseSimilarity: dense, bm25Overlap: overlap });
    }
    return groups;
  }

  /**
   * Adjudicate a single contradiction group. Sends both rows to the local
   * Ollama model and marks the loser as `superseded_by` the winner. No-op
   * when consolidation is disabled.
   */
  async resolve(group: ContradictionGroup): Promise<boolean> {
    if (!this._enabled) return false;
    const prompt = buildAdjudicationPrompt(group.a, group.b);
    let reply: string;
    try {
      reply = await this._ollama.chat(prompt);
    } catch {
      return false;
    }
    const verdict = parseAdjudication(reply);
    if (!verdict) return false;
    const winner = verdict.winner === "A" ? group.a : group.b;
    const loser = verdict.winner === "A" ? group.b : group.a;
    const log: ResolutionLogEntry = {
      at: this._now(),
      winnerId: winner.id,
      loserId: loser.id,
      model: this._ollama.model,
      justification: verdict.justification,
      denseSimilarity: group.denseSimilarity,
      bm25Overlap: group.bm25Overlap,
    };
    await this._provider.markSuperseded(loser.id, winner.id, log);
    return true;
  }

  /**
   * Walk every live semantic-tier row, detect contradictions against the
   * remaining rows, and adjudicate each group via the LLM. Short-circuits
   * with zero LLM calls when the consolidation toggle is off.
   */
  async sweep(): Promise<ContradictionSweepResult> {
    if (!this._enabled) {
      return { scanned: 0, groups: 0, resolved: 0, llmCalls: 0 };
    }
    const rows = await this._listSnapshot();
    const livePool = rows.filter(
      (r) => !r.supersededBy && r.text && r.text.length >= this._minTextLength,
    );
    const trimmed = livePool.slice(0, this._maxCandidates);
    // Pre-compute embeddings so the O(N^2) scan does not pay the embedder
    // twice per row.
    const vecs = new Map<string, Float32Array>();
    for (const row of trimmed) {
      vecs.set(row.id, row.embedding ?? (await this._embedder.embed(row.text)));
    }
    const supersededLocally = new Set<string>();
    let groups = 0;
    let resolved = 0;
    let llmCalls = 0;
    for (let i = 0; i < trimmed.length; i++) {
      const left = trimmed[i]!;
      if (supersededLocally.has(left.id)) continue;
      for (let j = i + 1; j < trimmed.length; j++) {
        const right = trimmed[j]!;
        if (supersededLocally.has(right.id)) continue;
        const dense = cosineSimilarity(vecs.get(left.id)!, vecs.get(right.id)!);
        if (dense <= this._denseThreshold) continue;
        const overlap = bm25Jaccard(left.text, right.text);
        if (overlap >= this._bm25Threshold) continue;
        groups += 1;
        llmCalls += 1;
        const ok = await this.resolve({
          a: left,
          b: right,
          denseSimilarity: dense,
          bm25Overlap: overlap,
        });
        if (ok) {
          resolved += 1;
          // Use the actual recorded provider state to decide which side
          // lost. We re-read the snapshot to find the new supersession.
          const fresh = await this._listSnapshot();
          for (const row of fresh) {
            if (row.id === left.id && row.supersededBy === right.id) {
              supersededLocally.add(left.id);
              break;
            }
            if (row.id === right.id && row.supersededBy === left.id) {
              supersededLocally.add(right.id);
              break;
            }
          }
        }
      }
    }
    return { scanned: trimmed.length, groups, resolved, llmCalls };
  }

  private async _listSnapshot(): Promise<SemanticRow[]> {
    const iter = await this._provider.list();
    return [...iter];
  }
}

/**
 * IdleTimeScheduler-compatible task shape (mirrors `IdleScheduledTask` from
 * `src/agents/IdleTimeScheduler.ts`). Declared here so the resolver does
 * not need to import the scheduler module directly -- the structural shape
 * is sufficient and keeps `core/memory/` free of `src/agents/` deps.
 */
export interface IdleSchedulerTaskShape {
  readonly id: string;
  readonly idleThresholdMs: number;
  readonly cadenceMs: number;
  run(): Promise<void>;
}

/** 1-hour cadence -- the contradiction sweep is opt-in and not latency-sensitive. */
export const CONTRADICTION_SWEEP_CADENCE_MS = 60 * 60 * 1000;
/** 5-minute idle threshold matches the warm-rebuild and decay-sweep workers. */
export const CONTRADICTION_SWEEP_IDLE_MS = 5 * 60 * 1000;

/**
 * Build the IdleTimeScheduler task. The task runs `sweep()` on the
 * resolver; when `resolver.enabled === false` the sweep returns
 * immediately so the cadence-driven invocation is a free no-op.
 */
export function createContradictionSweepTask(
  resolver: ContradictionResolver,
): IdleSchedulerTaskShape {
  return {
    id: "memory.contradiction-sweep",
    idleThresholdMs: CONTRADICTION_SWEEP_IDLE_MS,
    cadenceMs: CONTRADICTION_SWEEP_CADENCE_MS,
    async run(): Promise<void> {
      await resolver.sweep();
    },
  };
}
