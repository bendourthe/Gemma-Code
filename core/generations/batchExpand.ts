/**
 * v2.1.0 Phase 3 -- expand a batch spec into per-job parameter objects.
 *
 * Seed ranges are inclusive. Prompt matrices are a cartesian product of
 * prompts x negatives (a missing negatives list is treated as one empty
 * negative). Hard cap 64 children so a mistyped range cannot flood the GPU.
 */

export const MAX_BATCH_EXPANSION = 64;

export interface SeedRangeSpec {
  readonly kind: "seed-range";
  readonly start: number;
  readonly end: number;
}

export interface PromptMatrixSpec {
  readonly kind: "prompt-matrix";
  readonly prompts: readonly string[];
  readonly negatives?: readonly string[];
}

export interface CombinedBatchSpec {
  readonly kind: "combined";
  readonly seedStart?: number;
  readonly seedEnd?: number;
  readonly prompts?: readonly string[];
  readonly negatives?: readonly string[];
}

export type BatchSpec = SeedRangeSpec | PromptMatrixSpec | CombinedBatchSpec;

export function expandBatch(
  base: Record<string, unknown>,
  spec: BatchSpec,
): Record<string, unknown>[] {
  const seeds = seedList(spec);
  const prompts = promptList(spec);
  const negatives = negativeList(spec);
  const out: Record<string, unknown>[] = [];
  for (const seed of seeds) {
    for (const prompt of prompts) {
      for (const negative of negatives) {
        out.push({
          ...base,
          ...(seed !== undefined ? { seed } : {}),
          ...(prompt !== undefined ? { prompt } : {}),
          ...(negative !== undefined ? { negativePrompt: negative } : {}),
        });
        if (out.length > MAX_BATCH_EXPANSION) {
          throw new Error(`batch expansion exceeds ${MAX_BATCH_EXPANSION} jobs`);
        }
      }
    }
  }
  if (out.length === 0) return [{ ...base }];
  return out;
}

function seedList(spec: BatchSpec): readonly (number | undefined)[] {
  if (spec.kind === "seed-range") {
    return inclusiveRange(spec.start, spec.end);
  }
  if (spec.kind === "combined" && spec.seedStart !== undefined && spec.seedEnd !== undefined) {
    return inclusiveRange(spec.seedStart, spec.seedEnd);
  }
  return [undefined];
}

function promptList(spec: BatchSpec): readonly (string | undefined)[] {
  if (spec.kind === "prompt-matrix") return spec.prompts.length > 0 ? spec.prompts : [undefined];
  if (spec.kind === "combined" && spec.prompts && spec.prompts.length > 0) return spec.prompts;
  return [undefined];
}

function negativeList(spec: BatchSpec): readonly (string | undefined)[] {
  if (spec.kind === "prompt-matrix") {
    return spec.negatives && spec.negatives.length > 0 ? spec.negatives : [undefined];
  }
  if (spec.kind === "combined" && spec.negatives && spec.negatives.length > 0) {
    return spec.negatives;
  }
  return [undefined];
}

function inclusiveRange(start: number, end: number): number[] {
  const lo = Math.trunc(Math.min(start, end));
  const hi = Math.trunc(Math.max(start, end));
  const out: number[] = [];
  for (let n = lo; n <= hi; n += 1) out.push(n);
  return out;
}
