import { createRequire } from "node:module";
import type { HardwareTierConfig } from "./HardwareTier.types.js";
import { getLogger } from "../utils/logger.js";

// ---------------------------------------------------------------------------
// Phase 5 (v0.5.0): tiktoken-backed token counter with heuristic fallback.
//
// `countTokens(text)` returns precise token counts via OpenAI's `cl100k_base`
// encoding (matches the GPT-3.5/4 tokenizer family closely enough for budget
// allocation; for Gemma the exact count does not matter -- what matters is
// that the *delta* between two strings is consistent so context-compaction
// triggers fire at the right point). When tiktoken cannot load (native
// binding missing / unsupported platform), the fallback heuristic preserves
// the chars/4 contract so existing behavior degrades gracefully.
//
// The encoder load is lazy: the first call to `countTokens(...)` attempts
// `get_encoding('cl100k_base')`. Subsequent calls reuse the cached encoder.
// `disposeEncoder()` is exposed for tests and `extension.ts` deactivate().
// ---------------------------------------------------------------------------

const _heuristicChars = 4;
const _heuristicCodeMultiplier = 1.3;

interface TiktokenEncoder {
  encode(text: string): Uint32Array;
  free?(): void;
}

interface TiktokenModule {
  get_encoding(name: string): TiktokenEncoder;
}

let _encoder: TiktokenEncoder | null = null;
let _encoderLoadAttempted = false;
let _encoderLoadFailed = false;

const _tokenCounterStats = {
  tiktokenCalls: 0,
  heuristicCalls: 0,
  tiktokenLoadAttempted: false,
  tiktokenLoadFailed: false,
};

export interface TokenCounterStats {
  readonly tiktokenCalls: number;
  readonly heuristicCalls: number;
  readonly tiktokenLoadAttempted: boolean;
  readonly tiktokenLoadFailed: boolean;
}

function _ensureEncoderLoaded(): void {
  if (_encoderLoadAttempted) return;
  _encoderLoadAttempted = true;
  _tokenCounterStats.tiktokenLoadAttempted = true;
  try {
    // Resolve `tiktoken` lazily so platforms missing a prebuilt native binding
    // still start (the heuristic kicks in). createRequire works in both CJS
    // and ESM-compiled outputs of this project.
    const localRequire = createRequire(__filename);
    const mod = localRequire("tiktoken") as TiktokenModule;
    _encoder = mod.get_encoding("cl100k_base");
  } catch (err) {
    _encoderLoadFailed = true;
    _tokenCounterStats.tiktokenLoadFailed = true;
    getLogger().warn(
      "[PromptBudget] tiktoken load failed; falling back to chars/4 heuristic.",
      err,
    );
  }
}

/**
 * Heuristic token counter: chars/4 with a 1.3x multiplier when the input
 * contains a fenced code block. Deterministic, offline, and free of native
 * bindings. Used as the fallback path when tiktoken cannot load.
 */
export function heuristicTokenCount(text: string): number {
  if (!text) return 0;
  const chars = text.length;
  const hasCode = text.includes("```");
  return Math.ceil((chars / _heuristicChars) * (hasCode ? _heuristicCodeMultiplier : 1));
}

/**
 * Phase 5: precise token count via tiktoken `cl100k_base` when the native
 * binding can load; falls back to `heuristicTokenCount` otherwise.
 *
 * The first call eagerly loads the encoder (synchronously). On platforms
 * where the native binding is missing, the load is recorded as failed and
 * subsequent calls go straight to the heuristic.
 */
export function countTokens(text: string): number {
  if (!text) return 0;
  _ensureEncoderLoaded();
  if (_encoder && !_encoderLoadFailed) {
    try {
      _tokenCounterStats.tiktokenCalls += 1;
      return _encoder.encode(text).length;
    } catch (err) {
      // A runtime tiktoken failure (e.g. a string with malformed surrogates)
      // is rare but non-fatal -- fall through to the heuristic for this call
      // without disabling the encoder for future calls.
      getLogger().debug(
        "[PromptBudget] tiktoken encode threw; using heuristic for this call.",
        err,
      );
    }
  }
  _tokenCounterStats.heuristicCalls += 1;
  return heuristicTokenCount(text);
}

/**
 * Snapshot of the token-counter telemetry. Used by tests and the trace
 * dashboard to confirm whether tiktoken is in use.
 */
export function getTokenCounterStats(): TokenCounterStats {
  return { ..._tokenCounterStats };
}

/** Reset telemetry counters (test-only helper). */
export function resetTokenCounterStats(): void {
  _tokenCounterStats.tiktokenCalls = 0;
  _tokenCounterStats.heuristicCalls = 0;
  _tokenCounterStats.tiktokenLoadAttempted = _encoderLoadAttempted;
  _tokenCounterStats.tiktokenLoadFailed = _encoderLoadFailed;
}

/**
 * Free the cached tiktoken encoder so the underlying native handle is
 * released. Idempotent. Tests use this to force a fresh load attempt; the
 * extension's `deactivate()` calls this on shutdown.
 */
export function disposeEncoder(): void {
  if (_encoder && typeof _encoder.free === "function") {
    try {
      _encoder.free();
    } catch (err) {
      getLogger().debug("[PromptBudget] tiktoken free threw:", err);
    }
  }
  _encoder = null;
  _encoderLoadAttempted = false;
  _encoderLoadFailed = false;
  _tokenCounterStats.tiktokenLoadAttempted = false;
  _tokenCounterStats.tiktokenLoadFailed = false;
}

export interface BudgetAllocation {
  /** Tokens available for the system prompt (base instructions + tool declarations). */
  readonly systemPromptBudget: number;
  /** Tokens reserved for memory injection (Phase 3). */
  readonly memoryBudget: number;
  /** Tokens reserved for skill injection when a skill is active. */
  readonly skillBudget: number;
  /** Tokens available for conversation history. */
  readonly conversationBudget: number;
  /** Tokens reserved for the model's response generation. */
  readonly responseReserve: number;
}

export interface BudgetOverrides {
  systemPromptPercent?: number;
  memoryPercent?: number;
  skillPercent?: number;
  conversationPercent?: number;
  responsePercent?: number;
}

/**
 * Calculate token budget allocations from the total context window size.
 *
 * Default percentages (128K context = E4B):
 *   system 10%, memory 3%, skill 2%, conversation 65%, response 20%
 *
 * For 256K context (26B/31B), the same ratios scale proportionally.
 * If percentages sum to >100, they are scaled proportionally to fit.
 */
export function calculateBudget(
  maxTokens: number,
  overrides?: BudgetOverrides,
): BudgetAllocation {
  let systemPercent = overrides?.systemPromptPercent ?? 10;
  let memoryPercent = overrides?.memoryPercent ?? 3;
  let skillPercent = overrides?.skillPercent ?? 2;
  let conversationPercent = overrides?.conversationPercent ?? 65;
  let responsePercent = overrides?.responsePercent ?? 20;

  const total = systemPercent + memoryPercent + skillPercent + conversationPercent + responsePercent;
  if (total > 100) {
    getLogger().warn(
      `[PromptBudget] Budget percentages sum to ${total}% (>100%). Scaling proportionally.`,
    );
    const scale = 100 / total;
    systemPercent *= scale;
    memoryPercent *= scale;
    skillPercent *= scale;
    conversationPercent *= scale;
    responsePercent *= scale;
  }

  return {
    systemPromptBudget: Math.floor(maxTokens * systemPercent / 100),
    memoryBudget: Math.floor(maxTokens * memoryPercent / 100),
    skillBudget: Math.floor(maxTokens * skillPercent / 100),
    conversationBudget: Math.floor(maxTokens * conversationPercent / 100),
    responseReserve: Math.floor(maxTokens * responsePercent / 100),
  };
}

/**
 * Calculate budget allocations using a hardware tier configuration.
 * Convenience wrapper that passes tier-specific overrides to calculateBudget.
 */
export function calculateTierBudget(tierConfig: HardwareTierConfig): BudgetAllocation {
  return calculateBudget(tierConfig.contextWindow, tierConfig.budgetOverrides);
}

/**
 * v0.7.0 Phase 3 sub-task 3.7 -- per-model context-window override map.
 *
 * Returns the effective max-token count for `modelName`, falling back to
 * `globalMaxTokens` when no model-specific override exists.
 *
 * Resolution order:
 * 1. Exact match on `modelName` -> use its override.
 * 2. Otherwise -> fall back to `globalMaxTokens`.
 *
 * If both `maxTokens` and `minContextLimit` are present, `maxTokens` is
 * authoritative. `minContextLimit` only acts as a floor when `maxTokens` is
 * unset, so a misconfigured override can never silently shrink the model's
 * effective window below `minContextLimit`.
 */
export function resolveModelContextLimit(
  modelName: string,
  globalMaxTokens: number,
  perModelOverrides: Record<string, { maxTokens?: number; minContextLimit?: number }>,
): number {
  const override = perModelOverrides[modelName];
  if (!override) return globalMaxTokens;

  if (typeof override.maxTokens === "number" && override.maxTokens > 0) {
    return override.maxTokens;
  }
  if (typeof override.minContextLimit === "number" && override.minContextLimit > 0) {
    return Math.max(globalMaxTokens, override.minContextLimit);
  }
  return globalMaxTokens;
}
