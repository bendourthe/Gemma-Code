/**
 * v1.3.0 Phase 2 (adoption-skill-cleaner T003) -- model-agnostic token-cost helper.
 *
 * Implements insight I-04 from
 * `docs/v1/v1.3/comparison-skill-cleaner.md`: the
 * `ceil(utf8_bytes / 4)` approximation from skill-cleaner's "Analyzer Notes".
 *
 * Single shared estimator so the SkillAuditor (Phase 3), the existing
 * `CommandCompressor`, and any future memory tier do not each roll their own
 * approximation. If a consumer ever needs per-tokenizer fidelity, a separate
 * `TokenCostExact.ts` (wrapping `tiktoken`) is the right home -- this module
 * stays dependency-free and synchronous on purpose.
 */

/**
 * Estimate the token count of `text` as `ceil(utf8ByteLength(text) / 4)`.
 *
 * The formula is a model-agnostic *under-estimator* for CJK-heavy or
 * emoji-heavy text (those code points cost more bytes per token than the
 * 4-bytes-per-token rule of thumb assumes), and is correct within roughly
 * 10% for the BPE tokenizers used by Nexus's primary local models:
 *   - Gemma 4 (SentencePiece / 256K vocab)
 *   - Llama 3 / 3.1 (tiktoken-style BPE / 128K vocab)
 *   - Qwen 2.5 Coder (BPE / 152K vocab)
 *
 * Returns 0 for the empty string. Never throws.
 */
export function tokenize(text: string): number {
  return Math.ceil(Buffer.byteLength(text, "utf8") / 4);
}
