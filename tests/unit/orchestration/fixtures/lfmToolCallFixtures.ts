/**
 * LFM2.5-2.6B tool-call characterization fixtures (v1.19.0 Phase 2).
 *
 * Source of the grammar (not a live transcript unless noted):
 * Liquid AI Tool Use docs, fetched 2026-08-18
 * https://docs.liquid.ai/lfm/key-concepts/tool-use.md
 *
 * Observed / documented shape:
 * - Delimiters: <|tool_call_start|> ... <|tool_call_end|>
 * - Default body: Python-like list of keyword-arg calls
 *   [get_candidate_status(candidate_id="12345")]
 * - Optional JSON body when the system prompt asks for JSON function calls
 * - ChatML envelope with <|startoftext|> / <|im_start|>role / <|im_end|>
 * - Tool results come back as role "tool" (not LFM2's tool_response tokens)
 * - Prose may follow the closing token in the same assistant turn
 *
 * Parse hazards:
 * - Unclosed start token (no end): parser must return []
 * - Nested dict/list kwargs must not be eval'd
 * - Gemma4 XML parser must not false-positive these spans
 *
 * Live local emission: see LFM_LIVE_EMISSION_STATUS. Context length: see
 * LFM_CONTEXT_VERIFIED. Both follow "not_observed != absent".
 */

export const LFM_OFFICIAL_SINGLE = [
  "<|tool_call_start|>[get_candidate_status(candidate_id=\"12345\")]<|tool_call_end|>",
  "Checking the current status of candidate ID 12345.",
].join("\n");

/**
 * Captured 2026-08-18 on this host via Ollama
 * `hf.co/LiquidAI/LFM2.5-2.6B-GGUF:Q4_K_M` (local, N1). Quirks vs the docs
 * example: reasoning wrapped in think tags, single-quoted kwargs, no prose
 * after the closing token.
 */
export const LFM_LIVE_LOCAL =
  "<think>The user is asking me to check the status of a candidate with ID 12345. I need to use the get_candidate_status tool to retrieve this information. The tool requires a candidate_id parameter, which is provided as \"12345\". Let me call this tool.</think><|tool_call_start|>[get_candidate_status(candidate_id='12345')]<|tool_call_end|>";

export const LFM_MULTI_CALL = [
  "<|tool_call_start|>[read_file(path=\"src/foo.ts\"), grep(pattern=\"HarnessSelector\", path=\"modules\")]<|tool_call_end|>",
].join("\n");

export const LFM_JSON_OVERRIDE = [
  "<|tool_call_start|>[{\"name\":\"get_weather\",\"arguments\":{\"location\":\"Paris\"}}]<|tool_call_end|>",
].join("\n");

export const LFM_NESTED_KWARG = [
  "<|tool_call_start|>[search(query=\"lfm\", filters={\"tags\":[\"coding\"]})]<|tool_call_end|>",
].join("\n");

export const LFM_MALFORMED_UNCLOSED =
  "<|tool_call_start|>[get_candidate_status(candidate_id=\"12345\")";

export const LFM_PROSE_ONLY = "The candidate is in the Interview Scheduled stage.";

/** Well-formed fixtures used as A/B golden tasks (must parse under LFM, not default). */
export const LFM_PARSE_GOLDEN: Readonly<
  Record<string, { readonly text: string; readonly names: readonly string[] }>
> = Object.freeze({
  "lfm-official-single": {
    text: LFM_OFFICIAL_SINGLE,
    names: ["get_candidate_status"],
  },
  "lfm-multi-call": {
    text: LFM_MULTI_CALL,
    names: ["read_file", "grep"],
  },
  "lfm-json-override": {
    text: LFM_JSON_OVERRIDE,
    names: ["get_weather"],
  },
  "lfm-nested-kwarg": {
    text: LFM_NESTED_KWARG,
    names: ["search"],
  },
  "lfm-live-local": {
    text: LFM_LIVE_LOCAL,
    names: ["get_candidate_status"],
  },
});

/**
 * Live Ollama/llama.cpp emission against hf.co/LiquidAI/LFM2.5-2.6B-GGUF:Q4_K_M.
 * Updated when a local run captures raw output; otherwise not_observed.
 */
export const LFM_LIVE_EMISSION_STATUS = "observed" as const;

/**
 * Empirically recorded context. GGUF `lfm2.context_length` is 128000. A local
 * Ollama generate on 2026-08-18 accepted num_ctx=40960 and num_ctx=131072 on
 * a short prompt (full-length fill not run). Catalog stores 128000.
 */
export const LFM_CONTEXT_VERIFIED = 128000;
