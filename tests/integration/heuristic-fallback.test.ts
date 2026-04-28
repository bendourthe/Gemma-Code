/**
 * Heuristic embedder fallback -- threshold-elevation regression test.
 *
 * Pen-test finding F-007 (and known-gaps section 5.1) flagged that semantic
 * memory search keeps using the default 0.85 cosine threshold even when the
 * query embedding came from the heuristic fallback rather than Ollama. The
 * heuristic embedder is a deterministic 128-D bag-of-words approximation;
 * its noise floor is materially higher than Ollama's, so the configured
 * threshold should be raised when the query was produced heuristically.
 *
 * This test exercises the documented contract:
 *   - When the query embedding's provenance is `'heuristic'`,
 *     `UnifiedMemoryRetriever.searchToolOutputs` MUST raise the cosine
 *     threshold. Heuristic-tagged rows below the elevated threshold are
 *     filtered out; only rows >= the elevated threshold survive.
 *   - When provenance is `'ollama'`, the default 0.85 threshold applies and
 *     all matching rows are returned regardless of how the stored row was
 *     produced.
 *
 * The test is intentionally `it.todo` until Phase 5 (sub-task 5.1) lands the
 * threshold-elevation logic. The plan flags this gap explicitly: "this test
 * will FAIL until 5.1 lands -- that is intentional; mark it as `it.todo`
 * until Phase 5". Replace `it.todo` with `it` once
 * `searchToolOutputs` consults `provenance` and elevates the threshold.
 */

import { describe, it } from "vitest";

describe("heuristic-fallback threshold elevation", () => {
  it.todo(
    "filters heuristic-tagged rows at an elevated cosine threshold (Phase 5 sub-task 5.1)",
  );

  it.todo(
    "preserves the default 0.85 threshold when the query embedding came from Ollama",
  );

  it.todo(
    "falls back to keyword search when no rows clear the elevated threshold",
  );
});
