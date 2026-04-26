import type { Evictor } from "./types.js";

/**
 * Clock (Second-Chance) eviction.
 *
 * Keys are arranged on a logical ring with a single "use" bit each. On
 * access, the bit is set. On eviction, the hand sweeps forward, clearing
 * any bit it sees set; the first key with a clear bit is the victim. This
 * approximates LRU at lower bookkeeping cost and matches CPU-cache style
 * reference-bit hardware.
 */
export class ClockEvictor implements Evictor {
  private readonly _ring: string[] = [];
  private readonly _bits = new Map<string, boolean>();
  private _hand = 0;

  onInsert(key: string): void {
    if (this._bits.has(key)) {
      this._bits.set(key, true);
      return;
    }
    this._ring.push(key);
    this._bits.set(key, false);
  }

  onAccess(key: string): void {
    if (this._bits.has(key)) this._bits.set(key, true);
  }

  onRemove(key: string): void {
    if (!this._bits.has(key)) return;
    this._bits.delete(key);
    const idx = this._ring.indexOf(key);
    if (idx >= 0) {
      this._ring.splice(idx, 1);
      if (this._hand > idx) this._hand -= 1;
      if (this._hand >= this._ring.length) this._hand = 0;
    }
  }

  pickVictim(): string | null {
    if (this._ring.length === 0) return null;
    // At most two full sweeps (first to clear bits, second to definitely find a victim).
    for (let steps = 0; steps < this._ring.length * 2; steps++) {
      const key = this._ring[this._hand];
      if (key === undefined) return null;
      const used = this._bits.get(key) ?? false;
      if (!used) return key;
      this._bits.set(key, false);
      this._hand = (this._hand + 1) % this._ring.length;
    }
    return this._ring[this._hand] ?? null;
  }

  clear(): void {
    this._ring.length = 0;
    this._bits.clear();
    this._hand = 0;
  }

  stats(): Record<string, number> {
    return { entries: this._ring.length, hand: this._hand };
  }
}
