/**
 * v2.1.0 Phase 5 -- chat-template JSONL presets from the training-recipe skill.
 */

export interface QloraRecipe {
  readonly vramGB: number;
  readonly baseSize: string;
  readonly loraRank: number;
  readonly loraAlpha: number;
  readonly seqLen: number;
  readonly batch: number;
  readonly accum: number;
}

export const QLORA_RECIPES: readonly QloraRecipe[] = [
  { vramGB: 16, baseSize: "3B-8B", loraRank: 16, loraAlpha: 16, seqLen: 2048, batch: 1, accum: 8 },
  { vramGB: 24, baseSize: "8B-14B", loraRank: 32, loraAlpha: 32, seqLen: 2048, batch: 1, accum: 8 },
  { vramGB: 32, baseSize: "14B-32B", loraRank: 32, loraAlpha: 32, seqLen: 4096, batch: 1, accum: 4 },
];

export function recipeForVram(vramGB: number): QloraRecipe {
  let chosen = QLORA_RECIPES[0]!;
  for (const recipe of QLORA_RECIPES) {
    if (vramGB >= recipe.vramGB) chosen = recipe;
  }
  return chosen;
}
