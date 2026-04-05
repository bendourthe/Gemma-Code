import type { ToolCall, ToolName } from "./types.js";
import { TOOL_NAMES } from "./types.js";

export type ParseResult =
  | { ok: true; call: ToolCall }
  | { ok: false; raw: string; error: string };

// Matches <tool_call>…</tool_call> blocks (non-greedy, dotall).
const TOOL_CALL_RE = /<tool_call>([\s\S]*?)<\/tool_call>/g;

// Matches triple-backtick code fences (with optional language tag).
const CODE_FENCE_RE = /```[\s\S]*?```/g;

/**
 * Remove all triple-backtick code fences from text so that tool_call tags
 * embedded in code examples are not mistakenly parsed as real tool calls.
 */
function stripCodeFences(text: string): string {
  return text.replace(CODE_FENCE_RE, "");
}

function isToolName(value: unknown): value is ToolName {
  return typeof value === "string" && (TOOL_NAMES as readonly string[]).includes(value);
}

function parseSingle(raw: string): ParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.trim());
  } catch {
    return { ok: false, raw, error: "JSON parse error" };
  }

  if (typeof parsed !== "object" || parsed === null) {
    return { ok: false, raw, error: "Expected a JSON object" };
  }

  const obj = parsed as Record<string, unknown>;

  if (!isToolName(obj["tool"])) {
    return {
      ok: false,
      raw,
      error: `Unknown or missing tool name: ${String(obj["tool"])}`,
    };
  }

  if (typeof obj["id"] !== "string" || obj["id"].length === 0) {
    return { ok: false, raw, error: "Missing or empty 'id' field" };
  }

  if (typeof obj["parameters"] !== "object" || obj["parameters"] === null) {
    return { ok: false, raw, error: "Missing or non-object 'parameters' field" };
  }

  return {
    ok: true,
    call: {
      tool: obj["tool"],
      id: obj["id"],
      parameters: obj["parameters"] as Record<string, unknown>,
    },
  };
}

/**
 * Parse all <tool_call>…</tool_call> blocks found in `text`.
 * Blocks inside triple-backtick code fences are ignored.
 */
export function parseToolCalls(text: string): ParseResult[] {
  const stripped = stripCodeFences(text);
  const results: ParseResult[] = [];

  let match: RegExpExecArray | null;
  TOOL_CALL_RE.lastIndex = 0;
  while ((match = TOOL_CALL_RE.exec(stripped)) !== null) {
    const raw = match[1] ?? "";
    results.push(parseSingle(raw));
  }

  return results;
}

/** Returns true if `text` contains at least one valid-looking <tool_call> tag. */
export function hasToolCall(text: string): boolean {
  const stripped = stripCodeFences(text);
  TOOL_CALL_RE.lastIndex = 0;
  return TOOL_CALL_RE.test(stripped);
}

/**
 * Remove all <tool_call>…</tool_call> blocks from text (used before committing
 * the assistant message so the protocol tags are not shown to the user).
 */
export function stripToolCalls(text: string): string {
  return text.replace(TOOL_CALL_RE, "").trim();
}

/**
 * Format a tool result for injection as a user message back to the model.
 */
export function formatToolResult(id: string, result: unknown): string {
  return `<tool_result id="${id}">\n${JSON.stringify(result, null, 2)}\n</tool_result>`;
}
