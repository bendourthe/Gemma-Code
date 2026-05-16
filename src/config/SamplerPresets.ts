import type { LLMOptions } from "../llm/types.js";

/**
 * v0.8.0 Phase 4 sub-task 4.4 (items F4 / F5 / E4) -- sampler presets +
 * thinking modes.
 *
 * Three thinking-mode presets the user can select via `/thinking-mode <name>`
 * or the corresponding settings toggle. The presets map directly to
 * `LLMOptions` and a flag pair (`reasoning`, `maxTokens`). The runtime is
 * responsible for honouring `reasoning` -- the bare `LLMOptions` schema does
 * not carry it because the Ollama wire protocol does not exchange that flag
 * directly. The flag is consulted by `PromptBuilder` (thinking-mode section).
 *
 * Default values come from the jola.dev article on Gemma-4 / Qwen-tuned
 * sampler values: `temp 0.6 / top_p 0.95 / top_k 20 / min_p 0.0` for "think"
 * modes; concise nominal defaults for "nothink".
 */

export type ThinkingMode = "nothink" | "think" | "think-max";

/** Optional per-model fields. Surfaced via the new `PerModelLimits` map. */
export interface PerModelLimits {
  /** Whether the model supports tool calling. */
  readonly tools?: boolean;
  /** Whether the model supports a hidden reasoning channel. */
  readonly reasoning?: boolean;
  /** Maximum output tokens this model will produce in a single turn. */
  readonly maxTokens?: number;
  /**
   * Chat-template hint for the channel parser. `gemma-chat-template`
   * uses `<|channel>thought...<channel|>`; `qwen-chat-template` uses
   * `<think>...</think>`.
   */
  readonly thinkingFormat?: "gemma-chat-template" | "qwen-chat-template" | null;
}

export interface SamplerPreset {
  readonly mode: ThinkingMode;
  readonly options: LLMOptions;
  readonly reasoning: boolean;
  readonly maxTokens: number;
  readonly description: string;
}

/**
 * The three canonical presets. Edit with care -- the values are referenced
 * by snapshot tests and represent a stable user-facing contract.
 */
export const SAMPLER_PRESETS: Readonly<Record<ThinkingMode, SamplerPreset>> = {
  nothink: {
    mode: "nothink",
    options: { temperature: 0.7, top_p: 0.95, top_k: 64 },
    reasoning: false,
    maxTokens: 4096,
    description: "Direct response with no hidden reasoning channel.",
  },
  think: {
    mode: "think",
    options: { temperature: 0.6, top_p: 0.95, top_k: 20 },
    reasoning: true,
    maxTokens: 8192,
    description: "Qwen/jola-tuned sampler with reasoning channel enabled.",
  },
  "think-max": {
    mode: "think-max",
    options: { temperature: 0.6, top_p: 0.95, top_k: 20 },
    reasoning: true,
    maxTokens: 32768,
    description:
      "Think preset with extended budget. Auto-downgrades to `think` when context budget < 64K.",
  },
};

/**
 * Apply context-budget driven downgrade. `think-max` requires the model
 * context to be at least 64K (the budgeted output is 32K, doubled for input
 * headroom); otherwise it falls back to `think` so the prompt does not blow
 * past `num_ctx`.
 */
export function resolvePresetForBudget(
  mode: ThinkingMode,
  contextBudget: number,
): SamplerPreset {
  const preset = SAMPLER_PRESETS[mode];
  if (mode === "think-max" && contextBudget < 64_000) {
    return SAMPLER_PRESETS.think;
  }
  return preset;
}

/**
 * Parse a `/thinking-mode` argument string. Accepts the three canonical names
 * and returns `null` when the input is unrecognised so the command handler
 * can emit a usage hint instead of silently selecting a default.
 */
export function parseThinkingMode(raw: string): ThinkingMode | null {
  const v = raw.trim().toLowerCase();
  if (v === "nothink" || v === "think" || v === "think-max") return v;
  return null;
}
