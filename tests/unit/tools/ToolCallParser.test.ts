import { describe, it, expect } from "vitest";
import {
  parseToolCalls,
  hasToolCall,
  stripToolCalls,
  formatToolResult,
} from "../../../src/tools/ToolCallParser.js";

const validCall = JSON.stringify({
  tool: "read_file",
  id: "call_001",
  parameters: { path: "src/extension.ts" },
});

describe("parseToolCalls", () => {
  it("parses a single well-formed tool call", () => {
    const text = `Let me read the file.\n<tool_call>${validCall}</tool_call>`;
    const results = parseToolCalls(text);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      ok: true,
      call: {
        tool: "read_file",
        id: "call_001",
        parameters: { path: "src/extension.ts" },
      },
    });
  });

  it("parses multiple tool calls in one response", () => {
    const call2 = JSON.stringify({
      tool: "list_directory",
      id: "call_002",
      parameters: { path: "src" },
    });
    const text = `<tool_call>${validCall}</tool_call>\n<tool_call>${call2}</tool_call>`;
    const results = parseToolCalls(text);
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ ok: true });
    expect(results[1]).toMatchObject({ ok: true });
  });

  it("returns empty array when no tool call present", () => {
    expect(parseToolCalls("Just a normal reply.")).toEqual([]);
  });

  it("returns ok:false for malformed JSON inside the tag", () => {
    const results = parseToolCalls("<tool_call>not json</tool_call>");
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ ok: false, error: "JSON parse error" });
  });

  it("returns ok:false for unknown tool name", () => {
    const bad = JSON.stringify({ tool: "fly_drone", id: "x", parameters: {} });
    const results = parseToolCalls(`<tool_call>${bad}</tool_call>`);
    expect(results[0]).toMatchObject({ ok: false });
    expect((results[0] as { ok: false; error: string }).error).toMatch(/Unknown or missing tool/);
  });

  it("returns ok:false when id is missing", () => {
    const bad = JSON.stringify({ tool: "read_file", parameters: {} });
    const results = parseToolCalls(`<tool_call>${bad}</tool_call>`);
    expect(results[0]).toMatchObject({ ok: false });
  });

  it("returns ok:false when parameters is not an object", () => {
    const bad = JSON.stringify({ tool: "read_file", id: "x", parameters: "oops" });
    const results = parseToolCalls(`<tool_call>${bad}</tool_call>`);
    expect(results[0]).toMatchObject({ ok: false });
  });

  it("ignores tool calls inside triple-backtick code fences", () => {
    const text = "```\n<tool_call>" + validCall + "</tool_call>\n```";
    expect(parseToolCalls(text)).toHaveLength(0);
  });

  it("handles whitespace inside the tag gracefully", () => {
    const text = `<tool_call>\n  ${validCall}\n</tool_call>`;
    const results = parseToolCalls(text);
    expect(results[0]).toMatchObject({ ok: true });
  });

  it("parses all valid ToolName values", () => {
    const toolNames = [
      "read_file", "write_file", "edit_file", "create_file", "delete_file",
      "list_directory", "grep_codebase", "run_terminal", "web_search", "fetch_page",
    ] as const;
    for (const name of toolNames) {
      const raw = JSON.stringify({ tool: name, id: "x", parameters: {} });
      const [result] = parseToolCalls(`<tool_call>${raw}</tool_call>`);
      expect(result).toMatchObject({ ok: true, call: { tool: name } });
    }
  });
});

describe("hasToolCall", () => {
  it("returns true when a tool call tag is present", () => {
    expect(hasToolCall(`<tool_call>${validCall}</tool_call>`)).toBe(true);
  });

  it("returns false when no tool call tag is present", () => {
    expect(hasToolCall("Here is my answer.")).toBe(false);
  });

  it("returns false for tool calls inside code fences", () => {
    const fenced = "```\n<tool_call>" + validCall + "</tool_call>\n```";
    expect(hasToolCall(fenced)).toBe(false);
  });
});

describe("stripToolCalls", () => {
  it("removes <tool_call> blocks leaving surrounding text intact", () => {
    const text = `I'll read that.\n<tool_call>${validCall}</tool_call>\nDone.`;
    const stripped = stripToolCalls(text);
    expect(stripped).not.toContain("<tool_call>");
    expect(stripped).toContain("I'll read that.");
    expect(stripped).toContain("Done.");
  });

  it("removes multiple blocks", () => {
    const text = `<tool_call>${validCall}</tool_call>text<tool_call>${validCall}</tool_call>`;
    const stripped = stripToolCalls(text);
    expect(stripped).not.toContain("<tool_call>");
    expect(stripped).toContain("text");
  });

  it("returns unchanged text when no blocks present", () => {
    expect(stripToolCalls("Hello world")).toBe("Hello world");
  });
});

describe("formatToolResult", () => {
  it("produces a <tool_result> XML block with the id attribute", () => {
    const out = formatToolResult("call_001", { success: true, output: "content" });
    expect(out).toContain('<tool_result id="call_001">');
    expect(out).toContain("</tool_result>");
    expect(out).toContain('"success": true');
  });

  it("pretty-prints the JSON payload", () => {
    const out = formatToolResult("x", { a: 1 });
    expect(out).toContain('"a": 1');
  });
});
