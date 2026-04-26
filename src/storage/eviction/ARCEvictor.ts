import type { Evictor } from "./types.js";

/**
 * Adaptive Replacement Cache (ARC) eviction.
 *
 * Maintains four ordered queues:
 *   - T1: keys seen exactly once recently (recency).
 *   - T2: keys seen at least twice (frequency).
 *   - B1: ghost entries recently evicted from T1.
 *   - B2: ghost entries recently evicted from T2.
 *
 * The split point `_p` between T1 and T2 capacity adapts based on which
 * ghost list a recent miss hit, balancing recency vs. frequency without a
 * hand-tuned parameter. Ghosts hold no payload; they only inform the
 * adaptation. Total size of T1+T2 is what the cache holds; T1+B1+T2+B2 is
 * bounded at `2 * targetSize`.
 *
 * Reference: Megiddo & Modha, "ARC: A Self-Tuning, Low Overhead Replacement
 * Cache" (FAST 2003). This is a faithful but minimal port; performance is
 * not aggressively tuned.
 */
export class ARCEvictor implements Evictor {
  private readonly _t1 = new Map<string, true>();
  private readonly _t2 = new Map<string, true>();
  private readonly _b1 = new Map<string, true>();
  private readonly _b2 = new Map<string, true>();
  private readonly _targetSize: number;
  private _p = 0;

  /**
   * @param targetSize approximate cache size T1+T2 should converge toward.
   *   Used purely for adaptation; the cache caller still calls `pickVictim`
   *   when its own budget says so. Must be >= 1.
   */
  constructor(targetSize: number) {
    this._targetSize = Math.max(1, Math.floor(targetSize));
  }

  onInsert(key: string): void {
    // Already in the cache; treat as access.
    if (this._t1.has(key) || this._t2.has(key)) {
      this.onAccess(key);
      return;
    }
    if (this._b1.has(key)) {
      this._p = Math.min(this._targetSize, this._p + this._delta(this._b1.size, this._b2.size));
      this._b1.delete(key);
      this._t2.set(key, true);
      return;
    }
    if (this._b2.has(key)) {
      this._p = Math.max(0, this._p - this._delta(this._b2.size, this._b1.size));
      this._b2.delete(key);
      this._t2.set(key, true);
      return;
    }
    this._t1.set(key, true);
  }

  onAccess(key: string): void {
    if (this._t1.has(key)) {
      this._t1.delete(key);
      this._t2.set(key, true);
      return;
    }
    if (this._t2.has(key)) {
      this._t2.delete(key);
      this._t2.set(key, true);
    }
  }

  onRemove(key: string): void {
    this._t1.delete(key);
    this._t2.delete(key);
    this._b1.delete(key);
    this._b2.delete(key);
  }

  /**
   * Standard ARC replacement: evict from T1 if it overshoots `_p`, otherwise
   * from T2. The evicted key's ghost moves to B1/B2 so a re-fault can
   * adapt `_p`.
   */
  pickVictim(): string | null {
    if (this._t1.size === 0 && this._t2.size === 0) return null;
    const evictFromT1 = this._t1.size > 0 && (this._t1.size > this._p || this._t2.size === 0);
    if (evictFromT1) {
      const oldest = this._t1.keys().next();
      if (oldest.done) return null;
      const key = oldest.value;
      // Move to B1 ghost; cap B1 at targetSize.
      this._t1.delete(key);
      this._b1.set(key, true);
      this._capGhosts(this._b1);
      return key;
    }
    const oldest = this._t2.keys().next();
    if (oldest.done) return null;
    const key = oldest.value;
    this._t2.delete(key);
    this._b2.set(key, true);
    this._capGhosts(this._b2);
    return key;
  }

  clear(): void {
    this._t1.clear();
    this._t2.clear();
    this._b1.clear();
    this._b2.clear();
    this._p = 0;
  }

  stats(): Record<string, number> {
    return {
      t1: this._t1.size,
      t2: this._t2.size,
      b1: this._b1.size,
      b2: this._b2.size,
      p: this._p,
    };
  }

  private _delta(thisGhost: number, otherGhost: number): number {
    if (thisGhost === 0) return 1;
    return Math.max(1, Math.floor(otherGhost / thisGhost));
  }

  private _capGhosts(ghosts: Map<string, true>): void {
    while (ghosts.size > this._targetSize) {
      const oldest = ghosts.keys().next();
      if (oldest.done) break;
      ghosts.delete(oldest.value);
    }
  }
}
