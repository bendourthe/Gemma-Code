import type { Evictor } from "./types.js";

/**
 * Least-Recently-Used eviction.
 *
 * Backs the Phase 4 in-process cache by default. JavaScript `Map` preserves
 * insertion order, so re-inserting on access keeps the most recently used
 * key at the tail and `keys().next().value` is always the least-recently
 * used candidate.
 */
export class LRUEvictor implements Evictor {
  private readonly _order = new Map<string, true>();

  onInsert(key: string): void {
    if (this._order.has(key)) this._order.delete(key);
    this._order.set(key, true);
  }

  onAccess(key: string): void {
    if (!this._order.has(key)) return;
    this._order.delete(key);
    this._order.set(key, true);
  }

  onRemove(key: string): void {
    this._order.delete(key);
  }

  pickVictim(): string | null {
    const next = this._order.keys().next();
    return next.done ? null : next.value;
  }

  clear(): void {
    this._order.clear();
  }

  stats(): Record<string, number> {
    return { entries: this._order.size };
  }
}
