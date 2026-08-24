import { randomUUID } from "crypto";
import type { ToolCall, ToolName, ToolResult } from "./types.js";
import { BUILTIN_TOOL_NAMES } from "./types.js";
import type { ToolMetadata } from "./ToolCatalog.js";

// ---------------------------------------------------------------------------
// Regex patterns for Gemma 4 native tool protocol
// ---------------------------------------------------------------------------

/**
 * Matches the opening of a `<|tool_call>call:TOOL_NAME{` block. The closing
 * `}<tool_call|>` is located manually with balanced-brace scanning so that
 * nested object/array values in the body do not terminate the match early.
 *
 * Capture groups:
 *   1 - tool name (word chars, `:`, `-`, and `/` so MCP namespaces parse)
 */
const GEMMA4_TOOL_CALL_OPEN_RE = /<\|tool_call>call:([\w:/-]+)\{/g;
const GEMMA4_TOOL_CALL_CLOSE = "<tool_call|>";

/** Strip all `<|tool_call>...<tool_call|>` blocks (including nested braces). */
const GEMMA4_TOOL_CALL_ANY_RE = /<\|tool_call>[\s\S]*?<tool_call\|>/g;

/** Matches triple-backtick code fences (with optional language tag). */
const CODE_FENCE_RE = /```[\s\S]*?```/g;

/**
 * Matches a single key-value pair inside a Gemma 4 tool call body.
 * Handles both `<|"|>` delimited string values and bare numeric/boolean values.
 *
 * Note: nested object/array values (`key:{...}`, `key:[...]`) are handled by a
 * separate hand-written scan in `parseKeyValueBody` because regex cannot match
 * balanced brackets reliably. See `extractNestedJsonValues`.
 *
 * Examples:
 *   `path:<|"|>src/foo.ts<|"|>`  -> key="path", value="src/foo.ts"
 *   `max_results:10`             -> key="max_results", value="10"
 *   `recursive:true`             -> key="recursive", value="true"
 */
const KEY_VALUE_RE = /(\w+):<\|"\|>([\s\S]*?)<\|"\|>|(\w+):([^\s,}<|]+)/g;

/** Matches the start of a nested object/array value: `key:{` or `key:[`. */
const NESTED_VALUE_START_RE = /(\w+):([{\[])/g;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isToolName(value: unknown): value is ToolName {
  if (typeof value !== "string") return false;
  if ((BUILTIN_TOOL_NAMES as readonly string[]).includes(value)) return true;
  if (value.startsWith("mcp:")) return true;
  return false;
}

/** Remove triple-backtick code fences to avoid false-positive tool call matches. */
function stripCodeFences(text: string): string {
  return text.replace(CODE_FENCE_RE, "");
}

/**
 * Find the matching closing bracket for the opener at `start` in `text`.
 * Honors balanced nested brackets and JSON-style string spans (`"..."` with
 * `\` escapes). Returns the index AFTER the matching closer, or -1 if no
 * balanced match is found before end-of-input.
 */
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

/**
 * Extract `key:{...}` and `key:[...]` nested JSON values from the body.
 * Returns the parsed values plus a stripped body with those spans removed
 * so the bare-value regex does not see them.
 */
function extractNestedJsonValues(body: string): {
  values: Record<string, unknown>;
  stripped: string;
} {
  const values: Record<string, unknown> = {};
  let stripped = body;
  // Iterate until no more nested starts are found. Each pass extracts one span.
  for (;;) {
    NESTED_VALUE_START_RE.lastIndex = 0;
    const match = NESTED_VALUE_START_RE.exec(stripped);
    if (!match) break;
    const key = match[1]!;
    const openIdx = match.index + key.length + 1; // skip "key:"
    const endIdx = findBalancedEnd(stripped, openIdx);
    if (endIdx === -1) break; // malformed; bail out
    const jsonText = stripped.slice(openIdx, endIdx);
    try {
      values[key] = JSON.parse(jsonText);
    } catch {
      // Fall back to raw string so the model sees it round-trip.
      values[key] = jsonText;
    }
    // Remove the entire `key:{...}` (or `key:[...]`) span from the body.
    stripped = stripped.slice(0, match.index) + stripped.slice(endIdx);
  }
  return { values, stripped };
}

/**
 * Parse the key-value body of a Gemma 4 tool call into a parameter record.
 *
 * The body uses three formats:
 *   - String values: `key:<|"|>value<|"|>`
 *   - Bare values:   `key:123` or `key:true`
 *   - Nested JSON:   `key:{...}` or `key:[...]` (e.g., MCP tool args)
 */
function parseKeyValueBody(body: string): Record<string, unknown> {
  // First extract nested object/array values; they cannot be matched by regex.
  const nested = extractNestedJsonValues(body);
  const params: Record<string, unknown> = { ...nested.values };

  let match: RegExpExecArray | null;
  KEY_VALUE_RE.lastIndex = 0;
  while ((match = KEY_VALUE_RE.exec(nested.stripped)) !== null) {
    // String-delimited value (groups 1 & 2)
    if (match[1] !== undefined && match[2] !== undefined) {
      params[match[1]] = match[2];
      continue;
    }
    // Bare value (groups 3 & 4)
    if (match[3] !== undefined && match[4] !== undefined) {
      const raw = match[4];
      if (raw === "true") {
        params[match[3]] = true;
      } else if (raw === "false") {
        params[match[3]] = false;
      } else if (raw === "null") {
        params[match[3]] = null;
      } else {
        const num = Number(raw);
        params[match[3]] = Number.isNaN(num) ? raw : num;
      }
    }
  }

  return params;
}

// ---------------------------------------------------------------------------
// Public API — Parsing
// ---------------------------------------------------------------------------

export type ParseResult =
  | { ok: true; call: ToolCall }
  | { ok: false; raw: string; error: string };

/**
 * Parse all `<|tool_call>call:NAME{...}<tool_call|>` blocks found in `text`.
 * Blocks inside triple-backtick code fences are ignored. The body `{...}` is
 * located with balanced-brace scanning so nested object/array values are
 * preserved intact for `parseKeyValueBody`.
 *
 * Returns `{ results, hasAny }`. `hasAny` is true when at least one opening
 * tool_call token is present in `text` (regardless of whether its body parses
 * successfully), so callers can fast-path the "no tool call at all" branch
 * without a second scan of the message.
 */
export function parseToolCalls(text: string): {
  results: ParseResult[];
  hasAny: boolean;
} {
  const stripped = stripCodeFences(text);
  const results: ParseResult[] = [];
  let hasAny = false;

  let match: RegExpExecArray | null;
  GEMMA4_TOOL_CALL_OPEN_RE.lastIndex = 0;
  while ((match = GEMMA4_TOOL_CALL_OPEN_RE.exec(stripped)) !== null) {
    hasAny = true;
    const toolName = match[1] ?? "";
    const openBraceIdx = match.index + match[0].length - 1; // position of '{'
    const closeBraceEnd = findBalancedEnd(stripped, openBraceIdx);
    if (closeBraceEnd === -1) {
      // Malformed: unbalanced braces. Skip and keep scanning.
      continue;
    }
    const closeTokenStart = closeBraceEnd;
    // Allow optional whitespace between `}` and `<tool_call|>`.
    const trailing = stripped.slice(closeTokenStart);
    const trimmed = trailing.replace(/^\s*/, "");
    if (!trimmed.startsWith(GEMMA4_TOOL_CALL_CLOSE)) {
      continue;
    }
    const body = stripped.slice(openBraceIdx + 1, closeBraceEnd - 1);
    const raw = stripped.slice(
      match.index,
      closeTokenStart + (trailing.length - trimmed.length) + GEMMA4_TOOL_CALL_CLOSE.length,
    );

    // Advance the regex past the closing token so we do not rematch the prefix.
    GEMMA4_TOOL_CALL_OPEN_RE.lastIndex = match.index + raw.length;

    if (!isToolName(toolName)) {
      results.push({
        ok: false,
        raw,
        error: `Unknown or missing tool name: ${toolName}`,
      });
      continue;
    }

    const parameters = parseKeyValueBody(body);

    results.push({
      ok: true,
      call: {
        tool: toolName,
        id: randomUUID(),
        parameters,
      },
    });
  }

  // Malformed patterns (unbalanced braces, missing close token) that match
  // the opening regex still set hasAny=true; they just do not produce a
  // ParseResult. A fallback scan catches opening tokens the balanced-brace
  // loop skipped entirely (e.g. no '{' at all after the tag).
  if (!hasAny) {
    hasAny = /<\|tool_call>/.test(stripped);
  }

  return { results, hasAny };
}

/**
 * Remove all `<|tool_call>...<tool_call|>` blocks from text. Used before
 * committing the assistant message so protocol tags are not shown to the user.
 */
export function stripToolCalls(text: string): string {
  return text.replace(GEMMA4_TOOL_CALL_ANY_RE, "").trim();
}

// ---------------------------------------------------------------------------
// Public API — Formatting
// ---------------------------------------------------------------------------

/**
 * Format a tool result for injection back into the conversation.
 * Uses Gemma 4 native `<|tool_result>...<tool_result|>` format.
 */
export function formatToolResult(name: string, result: ToolResult): string {
  const payload = {
    name,
    origin: result.origin ?? "workspace_file",
    response: {
      success: result.success,
      output: result.output,
      ...(result.error !== undefined ? { error: result.error } : {}),
    },
  };
  return `<|tool_result>\n${JSON.stringify(payload, null, 2)}\n<tool_result|>`;
}

/**
 * Serialize tool metadata into Gemma 4 `<|tool>...<tool|>` declaration blocks
 * for inclusion in the system prompt.
 */
export function serializeToolDefinitions(tools: readonly ToolMetadata[]): string {
  const blocks = tools.map((tool) => {
    const properties: Record<string, { type: string; description: string }> = {};
    const required: string[] = [];

    for (const [key, param] of Object.entries(tool.parameters)) {
      properties[key] = { type: param.type, description: param.description };
      if (param.required) {
        required.push(key);
      }
    }

    const schema = {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: "object",
        properties,
        ...(required.length > 0 ? { required } : {}),
      },
    };

    return `<|tool>\n${JSON.stringify(schema, null, 2)}\n<tool|>`;
  });

  return blocks.join("\n\n");
}
