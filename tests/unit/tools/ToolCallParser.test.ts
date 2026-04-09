import { describe, it, expect } from "vitest";
import {
  parseToolCalls,
  hasToolCall,
  stripToolCalls,
  formatToolResult,
} from "../../../src/tools/ToolCallParser.js";

// Gemma 4 native format tool call
const validCall = '<|tool_call>call:read_file{path:<|"|>src/extension.ts<|"|>}<tool_call|>';

describe("parseToolCalls", () => {
  it("parses a single well-formed tool call", () => {
    const text = `Let me read the file.\n${validCall}`;
    const results = parseToolCalls(text);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      ok: true,
      call: {
        tool: "read_file",
        parameters: { path: "src/extension.ts" },
      },
    });
  });

  it("parses multiple tool calls in one response", () => {
    const call2 = '<|tool_call>call:list_directory{path:<|"|>src<|"|>}<tool_call|>';
    const text = `${validCall}\n${call2}`;
    const results = parseToolCalls(text);
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ ok: true });
    expect(results[1]).toMatchObject({ ok: true });
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

  it("ignores tool calls inside triple-backtick code fences", () => {
    const text = "```\n" + validCall + "\n```";
    expect(parseToolCalls(text)).toHaveLength(0);
  });

  it("parses bare numeric parameters", () => {
    const text = '<|tool_call>call:grep_codebase{pattern:<|"|>TODO<|"|>,max_results:5}<tool_call|>';
    const results = parseToolCalls(text);
    expect(results[0]).toMatchObject({
      ok: true,
      call: {
        tool: "grep_codebase",
        parameters: { pattern: "TODO", max_results: 5 },
      },
    });
  });

  it("parses bare boolean parameters", () => {
    const text = '<|tool_call>call:list_directory{path:<|"|>src<|"|>,recursive:true}<tool_call|>';
    const results = parseToolCalls(text);
    expect(results[0]).toMatchObject({
      ok: true,
      call: {
        tool: "list_directory",
        parameters: { path: "src", recursive: true },
      },
    });
  });

  it("parses all valid ToolName values", () => {
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

  it("generates a unique id for each parsed call", () => {
    const text = `${validCall}\n${validCall}`;
    const results = parseToolCalls(text);
    if (results[0]?.ok && results[1]?.ok) {
      expect(results[0].call.id).not.toBe(results[1].call.id);
    }
  });
});

describe("hasToolCall", () => {
  it("returns true when a tool call tag is present", () => {
    expect(hasToolCall(validCall)).toBe(true);
  });

  it("returns false when no tool call tag is present", () => {
    expect(hasToolCall("Here is my answer.")).toBe(false);
  });

  it("returns false for tool calls inside code fences", () => {
    const fenced = "```\n" + validCall + "\n```";
    expect(hasToolCall(fenced)).toBe(false);
  });
});

describe("stripToolCalls", () => {
  it("removes <|tool_call> blocks leaving surrounding text intact", () => {
    const text = `I'll read that.\n${validCall}\nDone.`;
    const stripped = stripToolCalls(text);
    expect(stripped).not.toContain("<|tool_call>");
    expect(stripped).toContain("I'll read that.");
    expect(stripped).toContain("Done.");
  });

  it("removes multiple blocks", () => {
    const text = `${validCall}text${validCall}`;
    const stripped = stripToolCalls(text);
    expect(stripped).not.toContain("<|tool_call>");
    expect(stripped).toContain("text");
  });

  it("returns unchanged text when no blocks present", () => {
    expect(stripToolCalls("Hello world")).toBe("Hello world");
  });
});

describe("formatToolResult", () => {
  it("produces a <|tool_result> block with the tool name", () => {
    const result = { id: "call_001", success: true, output: "content" };
    const out = formatToolResult("read_file", result);
    expect(out).toContain("<|tool_result>");
    expect(out).toContain("<tool_result|>");
    expect(out).toContain('"name": "read_file"');
    expect(out).toContain('"success": true');
  });

  it("includes error field when present", () => {
    const result = { id: "x", success: false, output: "", error: "not found" };
    const out = formatToolResult("read_file", result);
    expect(out).toContain('"error": "not found"');
  });
});
