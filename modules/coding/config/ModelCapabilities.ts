/**
 * v1.5.0 Phase 5 (adoption-ecosystem-2026-06 T015) -- per-model capability
 * resolution for the hot model-call path.
 *
 * Adopts report item 33 (`re-partial`): multimodal (image) input via the
 * Gemma 4 family's native vision capability. The authoritative declaration of
 * a model's multimodality is the catalog `multimodal: true` flag
 * (`core/registry/catalog.json`, surfaced on `ListedModel.multimodal`). The
 * model-call path, however, only ever holds the runtime Ollama tag string
 * (e.g. `hf.co/unsloth/gemma-4-12b-it-GGUF:Q4_K_XL` or `gemma4:e4b`), not the
 * loaded catalog entry. This module mirrors the catalog flag as a pure
 * name-matcher so the prompt-assembly sites can decide -- without a catalog
 * round-trip -- whether to forward image attachments to the model.
 *
 * A guard unit test asserts this matcher agrees with the catalog: every
 * catalog entry flagged `multimodal: true` must match here, so the two
 * sources cannot drift apart.
 *
 * Local-only: nothing here makes an outbound call.
 */

import { GEMMA4_GGUF_OLLAMA_BASE } from "./Gemma4GgufQuants.js";

/**
 * Runtime model-name fragments known to be vision-capable. Gemma 4 (every
 * served size, GGUF or Ollama-native) accepts native image input; the
 * matcher is deliberately conservative -- a model is treated as text-only
 * unless its tag clearly identifies a vision-capable family.
 *
 * `GEMMA4_GGUF_OLLAMA_BASE` is referenced only to keep this list anchored to
 * the same Gemma 4 GGUF reference the catalog/installer use; the `gemma-?4`
 * pattern already subsumes it.
 */
const VISION_CAPABLE_PATTERNS: readonly RegExp[] = [
  // `gemma4`, `gemma-4`, `gemma_4` in any tag segment (family or HF ref).
  /gemma[-_]?4/i,
  // Qwen 3.5 library tags (4b / 9b) accept native image input.
  /qwen3\.5/i,
];

void GEMMA4_GGUF_OLLAMA_BASE;

/**
 * Whether the named local model can accept image input. Returns `false` for
 * any unrecognized or text-only model so callers that hand it an image attach
 * nothing (text-only models ignore image input cleanly).
 *
 * @param modelName the runtime model tag (Ollama tag / HF ref / catalog id)
 */
export function isVisionCapableModel(modelName: string | undefined | null): boolean {
  if (!modelName) return false;
  return VISION_CAPABLE_PATTERNS.some((re) => re.test(modelName));
}
