/**
 * v1.1.0 Phase 6.6 -- Ebbinghaus decay sweep worker.
 *
 * Periodically evict stale memories using a closed-form Ebbinghaus retention
 * curve. The retention model is `R(t) = exp(-t / halfLife * ln(2))` where
 * `t = now - lastAccessedAt` and `halfLife` is per tier:
 *
 *   working   24 h
 *   episodic   7 d
 *   semantic  30 d
 *   graph    365 d
 *
 * An entry is evicted when both:
 *   * retention < `retentionFloor` (default 0.05), AND
 *   * accessCount < `minAccessCount`   (default 3)
 *
 * Eviction is delegated to the provider via `evict(id)`; the provider is
 * responsible for any tombstoning so a future restore command can recover
 * the row within the configured tombstone window.
 *
 * The sweep is intentionally pure-data: callers wire it into the
 * `IdleTimeScheduler` for the production cadence (24-hour) and use
 * `nexus memory decay --now` to fire it on demand for debugging.
 *
 * Adopts agentmemory A3 (see comparison-agentmemory.md Section 11.2 P1).
 */

import type { MemoryTier } from "./MemoryAuditLog.js";

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

export interface DecayHalfLives {
  readonly working: number;
  readonly episodic: number;
  readonly semantic: number;
  readonly graph: number;
}

/** Per-tier defaults, in milliseconds. */
export const DEFAULT_HALF_LIVES: DecayHalfLives = Object.freeze({
  working: 24 * HOUR_MS,
  episodic: 7 * DAY_MS,
  semantic: 30 * DAY_MS,
  graph: 365 * DAY_MS,
});

export interface DecayableEntry {
  readonly id: string;
  readonly tier: MemoryTier;
  readonly lastAccessedAt: number;
  readonly accessCount: number;
}

export interface DecayProvider {
  /** Yield every live (non-tombstoned) entry the sweep should consider. */
  list(): Iterable<DecayableEntry>;
  /**
   * Move the entry identified by `id` to a tombstone state (or hard
   * delete, depending on the underlying store). Return `true` on success.
   */
  evict(id: string): boolean;
}

export interface DecaySweepOptions {
  readonly halfLives?: Partial<DecayHalfLives>;
  readonly retentionFloor?: number;
  readonly minAccessCount?: number;
  readonly now?: () => number;
}

export interface DecaySweepResult {
  readonly scanned: number;
  readonly evicted: ReadonlyArray<{ readonly id: string; readonly tier: MemoryTier; readonly retention: number }>;
  readonly kept: number;
  readonly elapsedMs: number;
}

/** Closed-form retention curve. Exposed so callers can preview decisions. */
export function retentionAt(elapsedMs: number, halfLifeMs: number): number {
  if (halfLifeMs <= 0) return 0;
  if (elapsedMs <= 0) return 1;
  return Math.exp((-elapsedMs / halfLifeMs) * Math.LN2);
}

export class DecaySweep {
  private readonly _provider: DecayProvider;
  private readonly _halfLives: DecayHalfLives;
  private readonly _retentionFloor: number;
  private readonly _minAccessCount: number;
  private readonly _now: () => number;

  constructor(provider: DecayProvider, opts: DecaySweepOptions = {}) {
    this._provider = provider;
    this._halfLives = {
      working: opts.halfLives?.working ?? DEFAULT_HALF_LIVES.working,
      episodic: opts.halfLives?.episodic ?? DEFAULT_HALF_LIVES.episodic,
      semantic: opts.halfLives?.semantic ?? DEFAULT_HALF_LIVES.semantic,
      graph: opts.halfLives?.graph ?? DEFAULT_HALF_LIVES.graph,
    };
    this._retentionFloor = opts.retentionFloor ?? 0.05;
    this._minAccessCount = opts.minAccessCount ?? 3;
    this._now = opts.now ?? Date.now;
  }

  /** The half-lives applied by this sweep instance (test surface). */
  get halfLives(): DecayHalfLives {
    return this._halfLives;
  }

  /**
   * Decide whether `entry` should be evicted at `now`. Pure; exposed so
   * tests can pin the decision boundary without driving the full sweep.
   */
  shouldEvict(entry: DecayableEntry, now: number = this._now()): { evict: boolean; retention: number } {
    const halfLife = this._halfLifeFor(entry.tier);
    const elapsed = now - entry.lastAccessedAt;
    const retention = retentionAt(elapsed, halfLife);
    const evict = retention < this._retentionFloor && entry.accessCount < this._minAccessCount;
    return { evict, retention };
  }

  /**
   * Run a single sweep over every entry the provider yields. Returns the
   * tally. Errors thrown by `provider.evict` are caught per-row so a
   * single eviction failure cannot wedge the whole pass.
   */
  sweep(): DecaySweepResult {
    const start = this._now();
    const evicted: Array<{ id: string; tier: MemoryTier; retention: number }> = [];
    let scanned = 0;
    let kept = 0;
    for (const entry of this._provider.list()) {
      scanned += 1;
      const decision = this.shouldEvict(entry, start);
      if (!decision.evict) {
        kept += 1;
        continue;
      }
      let ok = false;
      try {
        ok = this._provider.evict(entry.id);
      } catch {
        ok = false;
      }
      if (ok) {
        evicted.push({ id: entry.id, tier: entry.tier, retention: decision.retention });
      } else {
        kept += 1;
      }
    }
    return {
      scanned,
      evicted,
      kept,
      elapsedMs: this._now() - start,
    };
  }

  private _halfLifeFor(tier: MemoryTier): number {
    switch (tier) {
      case "working":
        return this._halfLives.working;
      case "episodic":
        return this._halfLives.episodic;
      case "semantic":
        return this._halfLives.semantic;
      case "graph":
        return this._halfLives.graph;
    }
  }
}
