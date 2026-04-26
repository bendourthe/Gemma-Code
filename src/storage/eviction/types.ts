/**
 * Pluggable cache-eviction policy interface.
 *
 * The cache (e.g. `ToolOutputLru` in `src/storage/ToolOutputCache.ts`) owns
 * the actual key->value Map. The Evictor only tracks per-key access metadata
 * and answers one question: "if I have to evict, which key goes?"
 *
 * Contract:
 *   - `onInsert` is called once when a new key is admitted.
 *   - `onAccess` is called on every cache hit (after `onInsert`).
 *   - `onRemove` is called when the cache evicts or invalidates a key, so the
 *     Evictor can drop its bookkeeping. Calling `onRemove` for an unknown key
 *     is a no-op.
 *   - `pickVictim` returns the key the policy recommends evicting, or `null`
 *     when the Evictor is empty. The cache must call `onRemove` for the
 *     returned key before treating the eviction as final.
 *   - `clear` resets all internal state.
 *
 * Strategies do NOT enforce capacity; the cache decides when to call
 * `pickVictim` based on its own size/byte budgets. Strategies just answer
 * "who's least valuable right now?" given the access pattern they have seen.
 */
export interface Evictor {
  onInsert(key: string, size?: number): void;
  onAccess(key: string): void;
  onRemove(key: string): void;
  pickVictim(): string | null;
  clear(): void;
  /** Opaque diagnostic counters; shape depends on the strategy. */
  stats?(): Record<string, number>;
}

export type EvictionStrategy = "lru" | "lfu" | "arc" | "wtinylfu" | "clock";

/** Default strategy preserves the v0.4.0 behavior used by the ToolOutputCache. */
export const DEFAULT_EVICTION_STRATEGY: EvictionStrategy = "lru";

export const KNOWN_EVICTION_STRATEGIES: ReadonlyArray<EvictionStrategy> = [
  "lru",
  "lfu",
  "arc",
  "wtinylfu",
  "clock",
];

export function isEvictionStrategy(value: unknown): value is EvictionStrategy {
  return (
    typeof value === "string" &&
    (KNOWN_EVICTION_STRATEGIES as readonly string[]).includes(value)
  );
}
