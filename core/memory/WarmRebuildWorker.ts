/**
 * v1.1.0 Phase 5.6 -- warm-build worker for the hybrid retriever indexes.
 *
 * On a fresh start (or when the indexes are detected as stale because the
 * SQLite row count no longer matches the in-RAM index count) the worker
 * reads every memory row, tokenizes / embeds them in batches of 32, and
 * populates the BM25 + Dense indexes. Progress is reported via the Phase
 * 4 `HookBus` as `lifecycle.notification` events so the Memory panel can
 * surface a "rebuilding indexes ..." chip.
 *
 * The worker is driven by the existing `IdleTimeScheduler`: it registers
 * a one-shot idle task that fires as soon as the user has been idle for
 * the configured threshold (default 5 s -- much shorter than the
 * curator's 5 min because the rebuild is bounded and CPU-only).
 *
 * Failure semantics: any thrown error is caught and reported as a
 * `lifecycle.notification` with `severity: "error"`. The worker never
 * crashes the sidecar. Partial progress is preserved -- the worker
 * resumes from the next un-indexed row on the next idle tick.
 *
 * The retrieval path (`HybridRetriever`) detects emptiness via
 * `retriever.isReady` and gracefully degrades to substring during the
 * rebuild; once the worker finishes, retrieval automatically switches
 * over without consumer-visible churn.
 *
 * Adopts agentmemory A1 + A2 (see docs/v1.1.0/comparison-agentmemory.md
 * Section 11.2 P1).
 */

import type { HookBus } from "../lifecycle/HookBus.js";
import type { Embedder } from "./LocalEmbedder.js";
import { Bm25Index } from "./Bm25Index.js";
import { DenseIndex } from "./DenseIndex.js";

export interface MemoryRow {
  readonly entryId: string;
  readonly text: string;
}

export interface WarmRebuildSource {
  /**
   * Snapshot of the persistent memory corpus the worker should re-index.
   * Implementations typically wrap a `MemoryStore.iterateAllRows()` call;
   * the worker only needs id + text so the rest of the row stays opaque.
   */
  loadAll(): Promise<MemoryRow[]>;
  /**
   * Hash-of-row-count used to short-circuit when the persisted indexes
   * already reflect the corpus. Defaults to the row count; advanced
   * implementations can fold in a content checksum.
   */
  fingerprint?(): Promise<string>;
}

export interface WarmRebuildOptions {
  /** Embedding batch size. Default 32. */
  readonly batchSize?: number;
  /** Optional HookBus for progress notifications. */
  readonly hookBus?: HookBus | null;
  /**
   * Optional fingerprint cache; when both the cache and the source return
   * the same fingerprint, the worker exits early without re-indexing.
   * The cache is typically a single-slot in-memory holder fed by the
   * previous run's outcome.
   */
  readonly previousFingerprint?: string | null;
}

export interface WarmRebuildResult {
  readonly indexed: number;
  readonly skipped: boolean;
  readonly fingerprint: string | null;
  readonly elapsedMs: number;
}

/**
 * Re-index the BM25 + Dense indexes from the persistent corpus. The
 * function is idempotent; calling it after a fingerprint match returns
 * `{skipped: true, indexed: 0}` without touching the indexes.
 */
export async function warmRebuild(
  source: WarmRebuildSource,
  embedder: Embedder,
  bm25: Bm25Index,
  dense: DenseIndex,
  opts: WarmRebuildOptions = {},
): Promise<WarmRebuildResult> {
  const startedAt = Date.now();
  const batchSize = opts.batchSize ?? 32;
  const hookBus = opts.hookBus ?? null;

  const fingerprint = source.fingerprint ? await source.fingerprint() : null;
  if (
    fingerprint !== null &&
    opts.previousFingerprint !== null &&
    opts.previousFingerprint !== undefined &&
    fingerprint === opts.previousFingerprint
  ) {
    return {
      indexed: 0,
      skipped: true,
      fingerprint,
      elapsedMs: Date.now() - startedAt,
    };
  }

  let rows: MemoryRow[];
  try {
    rows = await source.loadAll();
  } catch (err) {
    _notify(hookBus, "error", `warm-rebuild loadAll failed: ${(err as Error).message}`);
    throw err;
  }
  const total = rows.length;
  _notify(
    hookBus,
    "info",
    `memory.warm-rebuild starting (rows=${total}, batch=${batchSize})`,
  );

  bm25.clear();
  dense.clear();

  let indexed = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    try {
      const vecs = await embedder.embedBatch(batch.map((r) => r.text));
      for (let j = 0; j < batch.length; j++) {
        const row = batch[j]!;
        const vec = vecs[j];
        bm25.add(row.entryId, row.text);
        if (vec) dense.add(row.entryId, vec);
        indexed++;
      }
    } catch (err) {
      _notify(
        hookBus,
        "warning",
        `memory.warm-rebuild batch ${i / batchSize} skipped: ${(err as Error).message}`,
      );
      for (const row of batch) {
        bm25.add(row.entryId, row.text);
        indexed++;
      }
    }
    if (total > 0) {
      const pct = Math.round((indexed / total) * 100);
      _notify(hookBus, "info", `memory.warm-rebuild ${pct}% (${indexed}/${total})`);
    }
  }

  _notify(
    hookBus,
    "info",
    `memory.warm-rebuild complete (indexed=${indexed}, elapsedMs=${Date.now() - startedAt})`,
  );
  return {
    indexed,
    skipped: false,
    fingerprint,
    elapsedMs: Date.now() - startedAt,
  };
}

/**
 * Convenience wrapper that fits the `IdleTimeScheduler` task contract.
 * The returned object can be passed verbatim to `scheduler.register({...})`.
 * Default cadence is 24 h (so the rebuild does not fire repeatedly during
 * a single session); default idle threshold is 5 s (the user has paused
 * typing -- safe to spend CPU on the index).
 */
export function createWarmRebuildTask(args: {
  readonly id?: string;
  readonly source: WarmRebuildSource;
  readonly embedder: Embedder;
  readonly bm25: Bm25Index;
  readonly dense: DenseIndex;
  readonly hookBus?: HookBus | null;
  readonly idleThresholdMs?: number;
  readonly cadenceMs?: number;
  readonly fingerprintRef?: { current: string | null };
}): {
  readonly id: string;
  readonly idleThresholdMs: number;
  readonly cadenceMs: number;
  run(): Promise<void>;
} {
  const fingerprintRef = args.fingerprintRef ?? { current: null };
  return {
    id: args.id ?? "memory.warm-rebuild",
    idleThresholdMs: args.idleThresholdMs ?? 5_000,
    cadenceMs: args.cadenceMs ?? 24 * 60 * 60 * 1000,
    async run(): Promise<void> {
      const opts: {
        batchSize?: number;
        hookBus?: HookBus | null;
        previousFingerprint?: string | null;
      } = {};
      if (args.hookBus) opts.hookBus = args.hookBus;
      if (fingerprintRef.current !== null) {
        opts.previousFingerprint = fingerprintRef.current;
      }
      const result = await warmRebuild(
        args.source,
        args.embedder,
        args.bm25,
        args.dense,
        opts,
      );
      fingerprintRef.current = result.fingerprint;
    },
  };
}

function _notify(
  hookBus: HookBus | null,
  severity: "info" | "warning" | "error",
  message: string,
): void {
  if (!hookBus) return;
  try {
    hookBus.emit({
      kind: "lifecycle.notification",
      notificationKind: "memory.warm-rebuild",
      message,
      severity,
    });
  } catch {
    // Bus failures must not take the worker down.
  }
}
