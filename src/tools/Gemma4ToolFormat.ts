import { randomUUID } from "crypto";
import type { ToolCall, ToolName, ToolResult } from "./types.js";
import { BUILTIN_TOOL_NAMES } from "./types.js";
import type { ToolMetadata } from "./ToolCatalog.js";

// ---------------------------------------------------------------------------
// Regex patterns for Gemma 4 native tool protocol
// ---------------------------------------------------------------------------

/**
 * Matches `<|tool_call>call:TOOL_NAME{...}<tool_call|>` blocks.
 *
 * Capture groups:
 *   1 - tool name (word characters)
 *   2 - key-value argument body (everything between `{` and `}`)
 */
const GEMMA4_TOOL_CALL_RE = /<\|tool_call>call:(\w+)\{([\s\S]*?)\}<tool_call\|>/g;

/** Matches triple-backtick code fences (with optional language tag). */
const CODE_FENCE_RE = /```[\s\S]*?```/g;

/**
 * Matches a single key-value pair inside a Gemma 4 tool call body.
 * Handles both `<|"|>` delimited string values and bare numeric/boolean values.
 *
 * Examples:
 *   `path:<|"|>src/foo.ts<|"|>`  -> key="path", value="src/foo.ts"
 *   `max_results:10`             -> key="max_results", value="10"
 *   `recursive:true`             -> key="recursive", value="true"
 */
const KEY_VALUE_RE = /(\w+):<\|"\|>([\s\S]*?)<\|"\|>|(\w+):([^\s,}<|]+)/g;

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
 * Parse the key-value body of a Gemma 4 tool call into a parameter record.
 *
 * The body uses two formats:
 *   - String values: `key:<|"|>value<|"|>`
 *   - Bare values:   `key:123` or `key:true`
 */
function parseKeyValueBody(body: string): Record<string, unknown> {
  const params: Record<string, unknown> = {};

  let match: RegExpExecArray | null;
  KEY_VALUE_RE.lastIndex = 0;
  while ((match = KEY_VALUE_RE.exec(body)) !== null) {
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
 * Blocks inside triple-backtick code fences are ignored.
 */
export function parseToolCalls(text: string): ParseResult[] {
  const stripped = stripCodeFences(text);
  const results: ParseResult[] = [];

  let match: RegExpExecArray | null;
  GEMMA4_TOOL_CALL_RE.lastIndex = 0;
  while ((match = GEMMA4_TOOL_CALL_RE.exec(stripped)) !== null) {
    const toolName = match[1] ?? "";
    const body = match[2] ?? "";
    const raw = match[0];

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

  return results;
}

/** Returns true if `text` contains at least one Gemma 4 tool call token. */
export function hasToolCall(text: string): boolean {
  const stripped = stripCodeFences(text);
  GEMMA4_TOOL_CALL_RE.lastIndex = 0;
  return GEMMA4_TOOL_CALL_RE.test(stripped);
}

/**
 * Remove all `<|tool_call>...<tool_call|>` blocks from text. Used before
 * committing the assistant message so protocol tags are not shown to the user.
 */
export function stripToolCalls(text: string): string {
  return text.replace(GEMMA4_TOOL_CALL_RE, "").trim();
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
