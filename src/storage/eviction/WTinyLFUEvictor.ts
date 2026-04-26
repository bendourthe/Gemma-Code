import type { Evictor } from "./types.js";

/**
 * Window-TinyLFU eviction (simplified).
 *
 * Combines a small recency-biased window LRU with a frequency-aware main
 * region. Admission to the main region is gated by a count-min sketch: a
 * candidate is admitted only if its sketch frequency exceeds the current
 * main victim's. This is the strategy used by Caffeine; we ship a faithful
 * but minimal port (count-min sketch, 4 hash rows; 1% window, 99% main).
 *
 * Reference: Einziger, Friedman & Manes, "TinyLFU: A Highly Efficient Cache
 * Admission Policy" (EuroSys 2014).
 */
export class WTinyLFUEvictor implements Evictor {
  private readonly _window = new Map<string, true>();
  private readonly _main = new Map<string, true>();
  private readonly _windowCap: number;
  private readonly _mainCap: number;
  private readonly _sketch: CountMinSketch;
  private _ageCounter = 0;

  /**
   * @param targetSize approximate combined cache size; the window region is
   *   1% (min 1) and the main region is the remainder.
   */
  constructor(targetSize: number) {
    const total = Math.max(2, Math.floor(targetSize));
    this._windowCap = Math.max(1, Math.floor(total * 0.01));
    this._mainCap = Math.max(1, total - this._windowCap);
    this._sketch = new CountMinSketch(total);
  }

  onInsert(key: string): void {
    this._sketch.increment(key);
    this._maybeAge();
    if (this._main.has(key) || this._window.has(key)) {
      this.onAccess(key);
      return;
    }
    // Admit to window first; window overflow promotes to main via _promote.
    this._window.set(key, true);
    if (this._window.size > this._windowCap) {
      const overflowKey = this._window.keys().next();
      if (!overflowKey.done) {
        this._window.delete(overflowKey.value);
        this._promote(overflowKey.value);
      }
    }
  }

  onAccess(key: string): void {
    this._sketch.increment(key);
    this._maybeAge();
    if (this._window.has(key)) {
      this._window.delete(key);
      this._window.set(key, true);
      return;
    }
    if (this._main.has(key)) {
      this._main.delete(key);
      this._main.set(key, true);
    }
  }

  onRemove(key: string): void {
    this._window.delete(key);
    this._main.delete(key);
  }

  pickVictim(): string | null {
    // Prefer evicting the LRU of the main region (the larger area). Fall
    // back to the window when main is empty.
    if (this._main.size > 0) {
      const victim = this._main.keys().next();
      return victim.done ? null : victim.value;
    }
    if (this._window.size > 0) {
      const victim = this._window.keys().next();
      return victim.done ? null : victim.value;
    }
    return null;
  }

  clear(): void {
    this._window.clear();
    this._main.clear();
    this._sketch.clear();
    this._ageCounter = 0;
  }

  /** Diagnostic: is this key currently retained in either region? */
  has(key: string): boolean {
    return this._window.has(key) || this._main.has(key);
  }

  stats(): Record<string, number> {
    return {
      window: this._window.size,
      main: this._main.size,
      windowCap: this._windowCap,
      mainCap: this._mainCap,
    };
  }

  /**
   * Window overflow: candidate `key` was bumped from the window. Either
   * admit it to the main region (evict main's LRU first) or drop it,
   * depending on which has the higher sketch frequency.
   */
  private _promote(candidate: string): void {
    if (this._main.size < this._mainCap) {
      this._main.set(candidate, true);
      return;
    }
    const victimEntry = this._main.keys().next();
    if (victimEntry.done) {
      this._main.set(candidate, true);
      return;
    }
    const victim = victimEntry.value;
    const candidateFreq = this._sketch.estimate(candidate);
    const victimFreq = this._sketch.estimate(victim);
    if (candidateFreq > victimFreq) {
      this._main.delete(victim);
      this._main.set(candidate, true);
    }
    // else: drop the candidate.
  }

  /**
   * Periodically halve all sketch counters so old hot keys eventually
   * surrender priority to genuinely frequent recent keys.
   */
  private _maybeAge(): void {
    this._ageCounter++;
    const ageThreshold = Math.max(16, this._mainCap * 10);
    if (this._ageCounter >= ageThreshold) {
      this._sketch.halve();
      this._ageCounter = 0;
    }
  }
}

/**
 * Tiny count-min sketch (4 rows, width derived from cache size). Counters
 * are clamped at 15 and stored in nibbles for a small memory footprint.
 * Provides O(1) approximate frequency queries.
 */
class CountMinSketch {
  private readonly _rows: Uint8Array[];
  private readonly _width: number;

  constructor(targetSize: number) {
    this._width = Math.max(8, Math.pow(2, Math.ceil(Math.log2(Math.max(8, targetSize * 4)))));
    this._rows = [
      new Uint8Array(this._width),
      new Uint8Array(this._width),
      new Uint8Array(this._width),
      new Uint8Array(this._width),
    ];
  }

  increment(key: string): void {
    const hashes = this._hashes(key);
    for (let i = 0; i < 4; i++) {
      const row = this._rows[i]!;
      const idx = hashes[i]! % this._width;
      const cur = row[idx]!;
      if (cur < 15) row[idx] = cur + 1;
    }
  }

  estimate(key: string): number {
    const hashes = this._hashes(key);
    let min = 15;
    for (let i = 0; i < 4; i++) {
      const row = this._rows[i]!;
      const idx = hashes[i]! % this._width;
      const v = row[idx]!;
      if (v < min) min = v;
    }
    return min;
  }

  halve(): void {
    for (const row of this._rows) {
      for (let i = 0; i < row.length; i++) row[i] = row[i]! >>> 1;
    }
  }

  clear(): void {
    for (const row of this._rows) row.fill(0);
  }

  /** Four cheap, distinct hashes from FNV-1a + xor-shifts. Deterministic. */
  private _hashes(key: string): [number, number, number, number] {
    let h = 0x811c9dc5;
    for (let i = 0; i < key.length; i++) {
      h ^= key.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    const h1 = h >>> 0;
    const h2 = (h ^ (h >>> 13)) >>> 0;
    const h3 = (Math.imul(h, 0x85ebca6b) ^ (h >>> 16)) >>> 0;
    const h4 = (Math.imul(h, 0xc2b2ae35) ^ (h >>> 17)) >>> 0;
    return [h1, h2, h3, h4];
  }
}
