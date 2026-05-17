/**
 * v1.0.0 Phase 3.2 -- per-model-family tool-call extractors.
 *
 * Each model family emits tool calls in a slightly different on-the-wire
 * grammar. The engine's internal representation is a flat `ToolCall` record;
 * the parsers below convert from each native grammar back to the canonical
 * shape so `AgentLoop` does not need to branch on model family.
 *
 *  - Gemma 4: `<|tool_call|>{...json}</|tool_call|>` inline blocks.
 *  - Llama 3.1+: pure-JSON message body matching
 *    `{"name": "...", "parameters": {...}}` (per the Llama 3 tool spec).
 *  - Qwen 2.5: a `<tool_call>...</tool_call>` XML envelope wrapping JSON.
 *  - DeepSeek Coder: Llama-3-style JSON, optionally wrapped in a `<tool>`
 *    fenced block.
 *
 * The parsers are defensive: malformed JSON returns an empty list rather
 * than throwing so a runaway model cannot crash the runtime; the caller
 * should still surface a tool-call error to the user.
 */

import type { ToolFormatName } from "../../../core/registry/ModelCatalog.js";

export interface ParsedToolCall {
  readonly name: string;
  readonly args: Record<string, unknown>;
  /** Raw substring (for round-trip logging). */
  readonly raw: string;
}

export interface ToolCallFormat {
  readonly name: ToolFormatName;
  parse(text: string): readonly ParsedToolCall[];
}

function safeJson(input: string): Record<string, unknown> | null {
  try {
    const obj = JSON.parse(input);
    if (obj && typeof obj === "object" && !Array.isArray(obj)) {
      return obj as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function parseLlamaShape(
  raw: string,
  jsonBody: string,
): ParsedToolCall | null {
  const obj = safeJson(jsonBody);
  if (!obj) return null;
  const name = typeof obj.name === "string" ? obj.name : null;
  const params =
    obj.parameters && typeof obj.parameters === "object"
      ? (obj.parameters as Record<string, unknown>)
      : obj.arguments && typeof obj.arguments === "object"
        ? (obj.arguments as Record<string, unknown>)
        : null;
  if (!name || !params) return null;
  return { name, args: params, raw };
}

const Gemma4Xml: ToolCallFormat = {
  name: "gemma4-xml",
  parse(text) {
    const out: ParsedToolCall[] = [];
    const pattern = /<\|tool_call\|>([\s\S]*?)<\/?\|tool_call\|>/g;
    for (;;) {
      const m = pattern.exec(text);
      if (!m) break;
      const body = (m[1] ?? "").trim();
      const obj = safeJson(body);
      if (!obj) continue;
      const name = typeof obj.name === "string" ? obj.name : null;
      const args =
        obj.arguments && typeof obj.arguments === "object"
          ? (obj.arguments as Record<string, unknown>)
          : obj.parameters && typeof obj.parameters === "object"
            ? (obj.parameters as Record<string, unknown>)
            : null;
      if (name && args) out.push({ name, args, raw: m[0] });
    }
    return out;
  },
};

const Llama3Json: ToolCallFormat = {
  name: "llama3-json",
  parse(text) {
    const out: ParsedToolCall[] = [];
    // Llama 3.1+ tool calls arrive either as the entire assistant turn being
    // a single JSON object, or as a JSON object preceded by a tool tag.
    const trimmed = text.trim();
    const direct = parseLlamaShape(trimmed, trimmed);
    if (direct) out.push(direct);
    const tagged = /<\|python_tag\|>([\s\S]+?)(?:<\|eom_id\|>|<\|eot_id\|>|$)/g;
    for (;;) {
      const m = tagged.exec(text);
      if (!m) break;
      const parsed = parseLlamaShape(m[0], (m[1] ?? "").trim());
      if (parsed) out.push(parsed);
    }
    return out;
  },
};

const QwenJson: ToolCallFormat = {
  name: "qwen-json",
  parse(text) {
    const out: ParsedToolCall[] = [];
    const pattern = /<tool_call>([\s\S]*?)<\/tool_call>/g;
    for (;;) {
      const m = pattern.exec(text);
      if (!m) break;
      const parsed = parseLlamaShape(m[0], (m[1] ?? "").trim());
      if (parsed) out.push(parsed);
    }
    return out;
  },
};

const DeepSeekJson: ToolCallFormat = {
  name: "deepseek-json",
  parse(text) {
    const out: ParsedToolCall[] = [];
    // DeepSeek finetunes generally use either bare JSON or a ```tool fenced
    // block. Try the fenced form first, then fall back to bare.
    const fenced = /```tool\s*([\s\S]*?)```/g;
    for (;;) {
      const m = fenced.exec(text);
      if (!m) break;
      const parsed = parseLlamaShape(m[0], (m[1] ?? "").trim());
      if (parsed) out.push(parsed);
    }
    if (out.length === 0) {
      const direct = parseLlamaShape(text, text.trim());
      if (direct) out.push(direct);
    }
    return out;
  },
};

const STRATEGIES: Record<ToolFormatName, ToolCallFormat> = {
  "gemma4-xml": Gemma4Xml,
  "llama3-json": Llama3Json,
  "qwen-json": QwenJson,
  "deepseek-json": DeepSeekJson,
};

export function getToolCallFormat(name: ToolFormatName): ToolCallFormat {
  const found = STRATEGIES[name];
  if (!found) throw new Error(`ToolCallFormat: unknown parser ${name}`);
  return found;
}

export const TOOL_FORMAT_NAMES: readonly ToolFormatName[] = Object.freeze([
  "gemma4-xml",
  "llama3-json",
  "qwen-json",
  "deepseek-json",
]);
