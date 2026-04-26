import { ARCEvictor } from "./ARCEvictor.js";
import { ClockEvictor } from "./ClockEvictor.js";
import { LFUEvictor } from "./LFUEvictor.js";
import { LRUEvictor } from "./LRUEvictor.js";
import { WTinyLFUEvictor } from "./WTinyLFUEvictor.js";
import {
  DEFAULT_EVICTION_STRATEGY,
  isEvictionStrategy,
  type EvictionStrategy,
  type Evictor,
} from "./types.js";

export {
  ARCEvictor,
  ClockEvictor,
  LFUEvictor,
  LRUEvictor,
  WTinyLFUEvictor,
  DEFAULT_EVICTION_STRATEGY,
  isEvictionStrategy,
};
export type { EvictionStrategy, Evictor };

/**
 * Factory for the configured eviction policy. Unknown strategy names fall
 * back to the v0.4.0-equivalent LRU; this keeps the cache running even if a
 * user lands a typo'd `gemma-code.cacheEvictionStrategy` setting.
 */
export function createEvictor(
  strategy: EvictionStrategy | string,
  targetSize: number,
): Evictor {
  const resolved = isEvictionStrategy(strategy) ? strategy : DEFAULT_EVICTION_STRATEGY;
  switch (resolved) {
    case "lru":
      return new LRUEvictor();
    case "lfu":
      return new LFUEvictor();
    case "arc":
      return new ARCEvictor(targetSize);
    case "wtinylfu":
      return new WTinyLFUEvictor(targetSize);
    case "clock":
      return new ClockEvictor();
    default:
      return new LRUEvictor();
  }
}
