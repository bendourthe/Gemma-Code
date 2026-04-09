import { describe, it, expect } from "vitest";
import {
  parseToolCalls,
  hasToolCall,
  stripToolCalls,
  formatToolResult,
  serializeToolDefinitions,
} from "../../../src/tools/Gemma4ToolFormat.js";
import { TOOL_CATALOG } from "../../../src/tools/ToolCatalog.js";

// ---------------------------------------------------------------------------
// parseToolCalls
// ---------------------------------------------------------------------------

describe("parseToolCalls", () => {
  it("parses a single tool call with a string parameter", () => {
    const text = 'I\'ll read that file.\n<|tool_call>call:read_file{path:<|"|>src/extension.ts<|"|>}<tool_call|>';
    const results = parseToolCalls(text);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      ok: true,
      call: {
        tool: "read_file",
        parameters: { path: "src/extension.ts" },
      },
    });
    // Should have a generated UUID id
    if (results[0]?.ok) {
      expect(results[0].call.id).toBeTruthy();
      expect(typeof results[0].call.id).toBe("string");
    }
  });

  it("parses multiple string parameters", () => {
    const text = '<|tool_call>call:edit_file{path:<|"|>src/foo.ts<|"|>,old_string:<|"|>hello<|"|>,new_string:<|"|>world<|"|>}<tool_call|>';
    const results = parseToolCalls(text);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      ok: true,
      call: {
        tool: "edit_file",
        parameters: {
          path: "src/foo.ts",
          old_string: "hello",
          new_string: "world",
        },
      },
    });
  });

  it("parses bare numeric values", () => {
    const text = '<|tool_call>call:grep_codebase{pattern:<|"|>TODO<|"|>,max_results:10}<tool_call|>';
    const results = parseToolCalls(text);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      ok: true,
      call: {
        tool: "grep_codebase",
        parameters: { pattern: "TODO", max_results: 10 },
      },
    });
  });

  it("parses bare boolean values", () => {
    const text = '<|tool_call>call:list_directory{path:<|"|>src<|"|>,recursive:true}<tool_call|>';
    const results = parseToolCalls(text);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      ok: true,
      call: {
        tool: "list_directory",
        parameters: { path: "src", recursive: true },
      },
    });
  });

  it("parses multiple tool calls in one response", () => {
    const text = [
      '<|tool_call>call:read_file{path:<|"|>a.ts<|"|>}<tool_call|>',
      '<|tool_call>call:list_directory{path:<|"|>src<|"|>}<tool_call|>',
    ].join("\n");
    const results = parseToolCalls(text);
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ ok: true, call: { tool: "read_file" } });
    expect(results[1]).toMatchObject({ ok: true, call: { tool: "list_directory" } });
  });

  it("returns empty array when no tool call present", () => {
    expect(parseToolCalls("Just a normal reply.")).toEqual([]);
  });

  it("returns ok:false for unknown tool name", () => {
    const text = '<|tool_call>call:fly_drone{target:<|"|>moon<|"|>}<tool_call|>';
    const results = parseToolCalls(text);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ ok: false });
    expect((results[0] as { ok: false; error: string }).error).toMatch(/Unknown or missing tool/);
  });

  it("ignores tool calls inside code fences", () => {
    const text = '```\n<|tool_call>call:read_file{path:<|"|>x<|"|>}<tool_call|>\n```';
    expect(parseToolCalls(text)).toHaveLength(0);
  });

  it("generates unique IDs for each call", () => {
    const text = [
      '<|tool_call>call:read_file{path:<|"|>a.ts<|"|>}<tool_call|>',
      '<|tool_call>call:read_file{path:<|"|>b.ts<|"|>}<tool_call|>',
    ].join("\n");
    const results = parseToolCalls(text);
    if (results[0]?.ok && results[1]?.ok) {
      expect(results[0].call.id).not.toBe(results[1].call.id);
    }
  });

  it("parses all valid tool names", () => {
    const toolNames = [
      "read_file", "write_file", "edit_file", "create_file", "delete_file",
      "list_directory", "grep_codebase", "run_terminal", "web_search", "fetch_page",
    ] as const;
    for (const name of toolNames) {
      const text = `<|tool_call>call:${name}{path:<|"|>test<|"|>}<tool_call|>`;
      const [result] = parseToolCalls(text);
      expect(result).toMatchObject({ ok: true, call: { tool: name } });
    }
  });

  it("handles string values containing special characters", () => {
    const text = '<|tool_call>call:write_file{path:<|"|>src/test.ts<|"|>,content:<|"|>const x = {a: 1};<|"|>}<tool_call|>';
    const results = parseToolCalls(text);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      ok: true,
      call: {
        tool: "write_file",
        parameters: { path: "src/test.ts", content: "const x = {a: 1};" },
      },
    });
  });
});

// ---------------------------------------------------------------------------
// hasToolCall
// ---------------------------------------------------------------------------

describe("hasToolCall", () => {
  it("returns true when a Gemma 4 tool call is present", () => {
    expect(hasToolCall('<|tool_call>call:read_file{path:<|"|>x<|"|>}<tool_call|>')).toBe(true);
  });

  it("returns false when no tool call is present", () => {
    expect(hasToolCall("Here is my answer.")).toBe(false);
  });

  it("returns false for tool calls inside code fences", () => {
    const fenced = '```\n<|tool_call>call:read_file{path:<|"|>x<|"|>}<tool_call|>\n```';
    expect(hasToolCall(fenced)).toBe(false);
  });

  it("returns false for old XML format tool calls", () => {
    const xml = '<tool_call>{"tool":"read_file","id":"1","parameters":{}}</tool_call>';
    expect(hasToolCall(xml)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// stripToolCalls
// ---------------------------------------------------------------------------

describe("stripToolCalls", () => {
  it("removes tool call blocks leaving surrounding text", () => {
    const text = 'Before.\n<|tool_call>call:read_file{path:<|"|>x<|"|>}<tool_call|>\nAfter.';
    const stripped = stripToolCalls(text);
    expect(stripped).not.toContain("<|tool_call>");
    expect(stripped).toContain("Before.");
    expect(stripped).toContain("After.");
  });

  it("removes multiple blocks", () => {
    const text = [
      '<|tool_call>call:read_file{path:<|"|>a<|"|>}<tool_call|>',
      "middle",
      '<|tool_call>call:read_file{path:<|"|>b<|"|>}<tool_call|>',
    ].join("\n");
    const stripped = stripToolCalls(text);
    expect(stripped).not.toContain("<|tool_call>");
    expect(stripped).toContain("middle");
  });

  it("returns unchanged text when no blocks present", () => {
    expect(stripToolCalls("Hello world")).toBe("Hello world");
  });
});

// ---------------------------------------------------------------------------
// formatToolResult
// ---------------------------------------------------------------------------

describe("formatToolResult", () => {
  it("produces a <|tool_result> block with name and response", () => {
    const result = { id: "x", success: true, output: "file content" };
    const out = formatToolResult("read_file", result);
    expect(out).toContain("<|tool_result>");
    expect(out).toContain("<tool_result|>");
    expect(out).toContain('"name": "read_file"');
    expect(out).toContain('"success": true');
    expect(out).toContain('"output": "file content"');
  });

  it("includes error field when present", () => {
    const result = { id: "x", success: false, output: "", error: "not found" };
    const out = formatToolResult("read_file", result);
    expect(out).toContain('"error": "not found"');
  });

  it("omits error field when not present", () => {
    const result = { id: "x", success: true, output: "ok" };
    const out = formatToolResult("read_file", result);
    expect(out).not.toContain('"error"');
  });
});

// ---------------------------------------------------------------------------
// serializeToolDefinitions
// ---------------------------------------------------------------------------

describe("serializeToolDefinitions", () => {
  it("produces <|tool> blocks for each tool", () => {
    const out = serializeToolDefinitions(TOOL_CATALOG);
    // Should have 10 tool blocks
    const toolOpenCount = (out.match(/<\|tool>/g) ?? []).length;
    const toolCloseCount = (out.match(/<tool\|>/g) ?? []).length;
    expect(toolOpenCount).toBe(10);
    expect(toolCloseCount).toBe(10);
  });

  it("includes tool name and description in each block", () => {
    const out = serializeToolDefinitions(TOOL_CATALOG);
    expect(out).toContain('"name": "read_file"');
    expect(out).toContain('"name": "write_file"');
    expect(out).toContain('"description"');
  });

  it("includes parameter schemas with required fields", () => {
    const out = serializeToolDefinitions(TOOL_CATALOG);
    expect(out).toContain('"parameters"');
    expect(out).toContain('"required"');
    expect(out).toContain('"properties"');
  });

  it("produces valid JSON inside each block", () => {
    const out = serializeToolDefinitions(TOOL_CATALOG);
    const blocks = out.split("<|tool>");
    for (const block of blocks) {
      const content = block.split("<tool|>")[0]?.trim();
      if (!content) continue;
      expect(() => JSON.parse(content)).not.toThrow();
    }
  });

  it("handles a single tool", () => {
    const single = [TOOL_CATALOG[0]!];
    const out = serializeToolDefinitions(single);
    expect((out.match(/<\|tool>/g) ?? []).length).toBe(1);
    expect(out).toContain('"name": "read_file"');
  });
});
