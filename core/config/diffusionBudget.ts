/**
 * v2.1.0 Phase 6 -- explicit diffusion VRAM/RAM budget knobs.
 * Defaults follow DiffusionTier. Older configs omit knobs and get defaults.
 */

import type { DiffusionTierId } from "./DiffusionTier.js";

export interface DiffusionMemoryBudget {
  readonly maxCacheVramGB: number;
  readonly maxCacheRamGB: number;
  readonly workingMemReserveGB: number;
  readonly layerStreaming: boolean;
}

export const DEFAULT_MEMORY_BUDGETS: Record<DiffusionTierId, DiffusionMemoryBudget> = {
  "diffusion-low": {
    maxCacheVramGB: 3,
    maxCacheRamGB: 8,
    workingMemReserveGB: 1,
    layerStreaming: true,
  },
  "diffusion-mid": {
    maxCacheVramGB: 6,
    maxCacheRamGB: 16,
    workingMemReserveGB: 1.5,
    layerStreaming: true,
  },
  "diffusion-high": {
    maxCacheVramGB: 10,
    maxCacheRamGB: 24,
    workingMemReserveGB: 2,
    layerStreaming: false,
  },
  "diffusion-pro": {
    maxCacheVramGB: 16,
    maxCacheRamGB: 32,
    workingMemReserveGB: 2,
    layerStreaming: false,
  },
};

export function defaultMemoryBudget(tier: DiffusionTierId): DiffusionMemoryBudget {
  return DEFAULT_MEMORY_BUDGETS[tier];
}

export function mergeMemoryBudget(
  tier: DiffusionTierId,
  override: Partial<DiffusionMemoryBudget> | null | undefined,
): DiffusionMemoryBudget {
  return { ...defaultMemoryBudget(tier), ...(override ?? {}) };
}

export interface BudgetValidationInput {
  readonly budget: DiffusionMemoryBudget;
  readonly modelMinVramGB: number;
  /** Sequential-read throughput in MB/s. Slow disks warn when streaming. */
  readonly diskSequentialMBps?: number;
}

export interface BudgetValidation {
  readonly ok: boolean;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

const SLOW_DISK_MBPS = 80;

export function validateMemoryBudget(input: BudgetValidationInput): BudgetValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const { budget, modelMinVramGB } = input;
  if (!(budget.maxCacheVramGB > 0) || !(budget.maxCacheRamGB > 0) || !(budget.workingMemReserveGB >= 0)) {
    errors.push("Budget numbers must be finite and non-negative (cache caps > 0).");
  }
  const usable = budget.maxCacheVramGB - budget.workingMemReserveGB;
  if (usable < modelMinVramGB && !budget.layerStreaming) {
    errors.push(
      `max_cache_vram_gb ${budget.maxCacheVramGB} minus reserve ${budget.workingMemReserveGB} is below the model minimum ${modelMinVramGB} GB. Enable layer streaming or raise the VRAM cap.`,
    );
  }
  if (
    budget.layerStreaming &&
    typeof input.diskSequentialMBps === "number" &&
    input.diskSequentialMBps < SLOW_DISK_MBPS
  ) {
    warnings.push(
      `Layer streaming on a ${input.diskSequentialMBps} MB/s disk may thrash. Prefer the tier defaults.`,
    );
  }
  return { ok: errors.length === 0, errors, warnings };
}
