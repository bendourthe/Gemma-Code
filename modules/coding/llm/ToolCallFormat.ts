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

function firstJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i]!;
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (c === "\\") {
        escape = true;
        continue;
      }
      if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === "{") depth += 1;
    else if (c === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

const Llama3Json: ToolCallFormat = {
  name: "llama3-json",
  parse(text) {
    const out: ParsedToolCall[] = [];
    // Llama 3.1+ tool calls arrive either as the entire assistant turn being
    // a single JSON object, or as a JSON object preceded by a tool tag.
    const trimmed = text.trim();
    const body = firstJsonObject(trimmed) ?? trimmed;
    const direct = parseLlamaShape(body, body);
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

/**
 * LFM2.5 native tool calls (Liquid docs, fetched 2026-08-18):
 *   <|tool_call_start|>[fn(arg="value")]<|tool_call_end|>
 * Default body is a Python-like list of keyword-arg calls. The system prompt
 * can request JSON instead; both shapes are accepted. Never eval.
 */
const LFM_SPAN_RE = /<\|tool_call_start\|>([\s\S]*?)<\|tool_call_end\|>/g;

function findBalancedEnd(text: string, start: number): number {
  const open = text[start];
  if (open !== "{" && open !== "[") return -1;
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (inString) {
      if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

const PARSE_FAIL = Symbol("lfm-parse-fail");

interface Cursor {
  readonly s: string;
  i: number;
}

function skipWs(c: Cursor): void {
  while (c.i < c.s.length && /\s/.test(c.s[c.i]!)) c.i++;
}

function parseQuoted(c: Cursor): string | typeof PARSE_FAIL {
  const quote = c.s[c.i];
  if (quote !== '"' && quote !== "'") return PARSE_FAIL;
  c.i++;
  let out = "";
  while (c.i < c.s.length) {
    const ch = c.s[c.i]!;
    if (ch === "\\") {
      const next = c.s[c.i + 1];
      if (next === undefined) return PARSE_FAIL;
      out += next;
      c.i += 2;
      continue;
    }
    if (ch === quote) {
      c.i++;
      return out;
    }
    out += ch;
    c.i++;
  }
  return PARSE_FAIL;
}

function parseLfmValue(c: Cursor): unknown | typeof PARSE_FAIL {
  skipWs(c);
  const ch = c.s[c.i];
  if (ch === undefined) return PARSE_FAIL;
  if (ch === '"' || ch === "'") return parseQuoted(c);
  if (ch === "{" || ch === "[") {
    const end = findBalancedEnd(c.s, c.i);
    if (end === -1) return PARSE_FAIL;
    const jsonText = c.s.slice(c.i, end);
    c.i = end;
    try {
      return JSON.parse(jsonText) as unknown;
    } catch {
      return PARSE_FAIL;
    }
  }
  if (c.s.startsWith("True", c.i) && !/[\w]/.test(c.s[c.i + 4] ?? "")) {
    c.i += 4;
    return true;
  }
  if (c.s.startsWith("False", c.i) && !/[\w]/.test(c.s[c.i + 5] ?? "")) {
    c.i += 5;
    return false;
  }
  if (c.s.startsWith("None", c.i) && !/[\w]/.test(c.s[c.i + 4] ?? "")) {
    c.i += 4;
    return null;
  }
  if (c.s.startsWith("true", c.i) && !/[\w]/.test(c.s[c.i + 4] ?? "")) {
    c.i += 4;
    return true;
  }
  if (c.s.startsWith("false", c.i) && !/[\w]/.test(c.s[c.i + 5] ?? "")) {
    c.i += 5;
    return false;
  }
  if (c.s.startsWith("null", c.i) && !/[\w]/.test(c.s[c.i + 4] ?? "")) {
    c.i += 4;
    return null;
  }
  const num = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(c.s.slice(c.i));
  if (num) {
    c.i += num[0].length;
    return Number(num[0]);
  }
  return PARSE_FAIL;
}

function parseIdent(c: Cursor): string | typeof PARSE_FAIL {
  const start = c.i;
  if (!/[A-Za-z_]/.test(c.s[c.i] ?? "")) return PARSE_FAIL;
  c.i++;
  while (c.i < c.s.length && /[\w.:/-]/.test(c.s[c.i]!)) c.i++;
  return c.s.slice(start, c.i);
}

function parsePythonicCallList(body: string, raw: string): ParsedToolCall[] {
  const c: Cursor = { s: body, i: 0 };
  skipWs(c);
  if (c.s[c.i] !== "[") {
    const wrapped = parsePythonicCallList(`[${body.trim()}]`, raw);
    return wrapped;
  }
  c.i++;
  const out: ParsedToolCall[] = [];
  skipWs(c);
  if (c.s[c.i] === "]") return out;
  while (c.i < c.s.length) {
    skipWs(c);
    if (c.s[c.i] === "]") break;
    const name = parseIdent(c);
    if (name === PARSE_FAIL) return [];
    skipWs(c);
    if (c.s[c.i] !== "(") return [];
    c.i++;
    const args: Record<string, unknown> = {};
    let positional = 0;
    skipWs(c);
    while (c.i < c.s.length && c.s[c.i] !== ")") {
      skipWs(c);
      if (c.s[c.i] === ")") break;
      const mark = c.i;
      const maybeKey = parseIdent(c);
      skipWs(c);
      if (maybeKey !== PARSE_FAIL && c.s[c.i] === "=") {
        c.i++;
        const value = parseLfmValue(c);
        if (value === PARSE_FAIL) return [];
        args[maybeKey] = value;
      } else {
        c.i = mark;
        const value = parseLfmValue(c);
        if (value === PARSE_FAIL) return [];
        args[`_${positional}`] = value;
        positional++;
      }
      skipWs(c);
      if (c.s[c.i] === ",") {
        c.i++;
        continue;
      }
      if (c.s[c.i] === ")") break;
      return [];
    }
    if (c.s[c.i] !== ")") return [];
    c.i++;
    out.push({ name, args, raw });
    skipWs(c);
    if (c.s[c.i] === ",") {
      c.i++;
      continue;
    }
    if (c.s[c.i] === "]") break;
    return [];
  }
  return out;
}

function parseLfmJsonArray(body: string, raw: string): ParsedToolCall[] | null {
  if (!/^\s*\[\s*\{/.test(body)) return null;
  try {
    const arr = JSON.parse(body) as unknown;
    if (!Array.isArray(arr)) return [];
    const out: ParsedToolCall[] = [];
    for (const item of arr) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const rec = item as Record<string, unknown>;
      const name = typeof rec.name === "string" ? rec.name : null;
      const params =
        rec.parameters && typeof rec.parameters === "object" && !Array.isArray(rec.parameters)
          ? (rec.parameters as Record<string, unknown>)
          : rec.arguments && typeof rec.arguments === "object" && !Array.isArray(rec.arguments)
            ? (rec.arguments as Record<string, unknown>)
            : null;
      if (name && params) out.push({ name, args: params, raw });
    }
    return out;
  } catch {
    return [];
  }
}

const LfmPythonic: ToolCallFormat = {
  name: "lfm-pythonic",
  parse(text) {
    const out: ParsedToolCall[] = [];
    LFM_SPAN_RE.lastIndex = 0;
    for (;;) {
      const m = LFM_SPAN_RE.exec(text);
      if (!m) break;
      const raw = m[0];
      const body = (m[1] ?? "").trim();
      if (body.length === 0 || body === "[]") continue;
      const jsonCalls = parseLfmJsonArray(body, raw);
      if (jsonCalls) {
        out.push(...jsonCalls);
        continue;
      }
      out.push(...parsePythonicCallList(body, raw));
    }
    return out;
  },
};

const STRATEGIES: Record<ToolFormatName, ToolCallFormat> = {
  "gemma4-xml": Gemma4Xml,
  "llama3-json": Llama3Json,
  "qwen-json": QwenJson,
  "deepseek-json": DeepSeekJson,
  "lfm-pythonic": LfmPythonic,
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
  "lfm-pythonic",
]);
