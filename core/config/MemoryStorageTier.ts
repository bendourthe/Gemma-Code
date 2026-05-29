/**
 * v1.2.0 Phase 4.3 -- MemoryStorageTier policy.
 *
 * Sibling enum to `DiffusionTier` that selects which on-disk dense-index
 * implementation `HybridRetriever` constructs. `Standard` uses the
 * embedding-bearing `DenseIndex`; `Pruned` uses the LEANN-derived
 * `PrunedDenseIndex` (graph + text only, embeddings recomputed on query).
 *
 * The tier defaults to `Standard` for v1.2.0; users opt in via the
 * `nexus.memory.storageTier` setting (or the migration script under
 * `scripts/migrate-dense-index-to-pruned.ts`). The Phase 4.4 benchmark
 * decides whether a later cycle promotes `Pruned` to the default.
 *
 * See `docs/versions/v1/v1.2.0/plans/adoption-ecosystem-2026-05.md` Phase 4.3 for the
 * full design context.
 */

export type MemoryStorageTierId = "standard" | "pruned";

export interface MemoryStorageTierConfig {
  readonly id: MemoryStorageTierId;
  readonly label: string;
  /** One-line user-facing description for the Settings page. */
  readonly description: string;
  /**
   * Expected on-disk size as a fraction of the Standard tier. `1.0` means
   * "the same"; `0.2` means "20% of Standard"; used by the Settings page
   * to show a savings estimate.
   */
  readonly storageRatio: number;
  /**
   * Estimated recall drop in percentage points vs Standard (positive numbers
   * mean lower recall). `0` for Standard; `<=5` for Pruned per the Phase 4
   * stability gate.
   */
  readonly recallDeltaPp: number;
}

export const MEMORY_STORAGE_TIER_CONFIGS: Record<
  MemoryStorageTierId,
  MemoryStorageTierConfig
> = {
  standard: {
    id: "standard",
    label: "Standard (full vectors)",
    description:
      "Persists every chunk's embedding to disk. Default for v1.2.0 because the on-disk cost is well-understood and recall is exact.",
    storageRatio: 1.0,
    recallDeltaPp: 0,
  },
  pruned: {
    id: "pruned",
    label: "Pruned (graph + recompute)",
    description:
      "LEANN-derived. Stores only a kNN graph and chunk text; embeddings are recomputed on the search path. ~80% smaller on disk; recall within 5pp of Standard.",
    storageRatio: 0.2,
    recallDeltaPp: 5,
  },
};

export const DEFAULT_MEMORY_STORAGE_TIER: MemoryStorageTierId = "standard";

/**
 * Validate a settings string and return a known tier id; unknown values
 * fall back to the default.
 */
export function resolveMemoryStorageTier(
  raw: string | null | undefined,
): MemoryStorageTierId {
  if (raw && (raw === "standard" || raw === "pruned")) return raw;
  return DEFAULT_MEMORY_STORAGE_TIER;
}

export function getMemoryStorageTierConfig(
  id: MemoryStorageTierId,
): MemoryStorageTierConfig {
  const config = MEMORY_STORAGE_TIER_CONFIGS[id];
  if (!config) {
    throw new Error(`Invalid memory storage tier id: ${String(id)}`);
  }
  return config;
}

export interface ResolvedMemoryStorageTier {
  readonly active: MemoryStorageTierId;
  readonly config: MemoryStorageTierConfig;
}

/**
 * Combine the raw `nexus.memory.storageTier` setting with the default so
 * downstream wiring has both the active id and its config in one shape.
 */
export function resolveMemoryStorage(
  raw: string | null | undefined,
): ResolvedMemoryStorageTier {
  const active = resolveMemoryStorageTier(raw);
  return { active, config: getMemoryStorageTierConfig(active) };
}
