import type { Evictor } from "./types.js";

/**
 * Least-Frequently-Used eviction.
 *
 * Tracks an integer frequency per key. On a tie, falls back to insertion
 * order (oldest entry at the lowest frequency wins). Suited to workloads
 * where popular paths recur and one-shot reads should age out fast.
 */
export class LFUEvictor implements Evictor {
  private readonly _counts = new Map<string, number>();
  private readonly _insertion = new Map<string, number>();
  private _seq = 0;

  onInsert(key: string): void {
    if (!this._counts.has(key)) {
      this._insertion.set(key, ++this._seq);
    }
    this._counts.set(key, (this._counts.get(key) ?? 0) + 1);
  }

  onAccess(key: string): void {
    if (!this._counts.has(key)) return;
    this._counts.set(key, (this._counts.get(key) ?? 0) + 1);
  }

  onRemove(key: string): void {
    this._counts.delete(key);
    this._insertion.delete(key);
  }

  pickVictim(): string | null {
    let victim: string | null = null;
    let minCount = Number.POSITIVE_INFINITY;
    let minSeq = Number.POSITIVE_INFINITY;
    for (const [key, count] of this._counts) {
      if (count < minCount) {
        victim = key;
        minCount = count;
        minSeq = this._insertion.get(key) ?? 0;
        continue;
      }
      if (count === minCount) {
        const seq = this._insertion.get(key) ?? 0;
        if (seq < minSeq) {
          victim = key;
          minSeq = seq;
        }
      }
    }
    return victim;
  }

  clear(): void {
    this._counts.clear();
    this._insertion.clear();
    this._seq = 0;
  }

  stats(): Record<string, number> {
    return { entries: this._counts.size };
  }
}
