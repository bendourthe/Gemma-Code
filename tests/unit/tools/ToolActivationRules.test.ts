import { describe, it, expect } from "vitest";
import {
  computeToolActivation,
  type ToolActivationContext,
} from "../../../src/tools/ToolActivationRules.js";
import type { DynamicToolMetadata } from "../../../src/tools/ToolCatalog.js";
import type { BuiltinToolName, McpToolName } from "../../../src/tools/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBuiltin(name: BuiltinToolName): DynamicToolMetadata {
  return { name, description: `${name} tool`, parameters: {}, source: "builtin", priority: 0 };
}

function makeMcp(name: string, priority = 100): DynamicToolMetadata {
  const qualified: McpToolName = `mcp:${name}`;
  return { name: qualified, description: `MCP ${name}`, parameters: {}, source: "mcp", priority };
}

const ALL_BUILTINS: DynamicToolMetadata[] = [
  makeBuiltin("read_file"),
  makeBuiltin("write_file"),
  makeBuiltin("edit_file"),
  makeBuiltin("create_file"),
  makeBuiltin("delete_file"),
  makeBuiltin("list_directory"),
  makeBuiltin("grep_codebase"),
  makeBuiltin("run_terminal"),
  makeBuiltin("web_search"),
  makeBuiltin("fetch_page"),
];

function defaultContext(overrides?: Partial<ToolActivationContext>): ToolActivationContext {
  return {
    ollamaReachable: true,
    networkAvailable: true,
    readOnlySession: false,
    totalToolCount: ALL_BUILTINS.length,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("computeToolActivation", () => {
  it("disables no tools when all conditions are nominal", () => {
    const result = computeToolActivation(ALL_BUILTINS, defaultContext());
    expect(result.disabledTools.size).toBe(0);
  });

  // Rule 1: Ollama unreachable
  it("disables ALL tools when Ollama is unreachable", () => {
    const result = computeToolActivation(
      ALL_BUILTINS,
      defaultContext({ ollamaReachable: false }),
    );
    expect(result.disabledTools.size).toBe(ALL_BUILTINS.length);
    for (const tool of ALL_BUILTINS) {
      expect(result.disabledTools.has(tool.name)).toBe(true);
    }
  });

  // Rule 2: No network
  it("disables web_search and fetch_page when network is unavailable", () => {
    const result = computeToolActivation(
      ALL_BUILTINS,
      defaultContext({ networkAvailable: false }),
    );
    expect(result.disabledTools.has("web_search")).toBe(true);
    expect(result.disabledTools.has("fetch_page")).toBe(true);
    expect(result.disabledTools.has("read_file")).toBe(false);
  });

  // Rule 3: Read-only session
  it("disables write/execute tools in a read-only session", () => {
    const result = computeToolActivation(
      ALL_BUILTINS,
      defaultContext({ readOnlySession: true }),
    );
    for (const name of ["write_file", "edit_file", "create_file", "delete_file", "run_terminal"] as const) {
      expect(result.disabledTools.has(name)).toBe(true);
    }
    expect(result.disabledTools.has("read_file")).toBe(false);
    expect(result.disabledTools.has("grep_codebase")).toBe(false);
  });

  it("disables browser tools when the network is unavailable or the session is read-only", () => {
    const browser = [
      makeBuiltin("browser_navigate"),
      makeBuiltin("browser_click"),
      makeBuiltin("browser_type"),
      makeBuiltin("browser_aria_snapshot"),
      makeBuiltin("browser_close"),
    ];
    const tools = [...ALL_BUILTINS, ...browser];
    const offline = computeToolActivation(tools, defaultContext({ networkAvailable: false }));
    expect(offline.disabledTools.has("browser_navigate")).toBe(true);
    expect(offline.disabledTools.has("browser_close")).toBe(false);
    const ro = computeToolActivation(tools, defaultContext({ readOnlySession: true }));
    expect(ro.disabledTools.has("browser_navigate")).toBe(true);
    expect(ro.disabledTools.has("browser_close")).toBe(true);
  });

  it("trims browser specialty tools before codegraph when over the cap", () => {
    const tools = [
      ...ALL_BUILTINS,
      makeBuiltin("browser_navigate"),
      makeBuiltin("browser_click"),
      makeBuiltin("codegraph_search"),
      makeBuiltin("codegraph_context"),
      makeBuiltin("codegraph_trace"),
      makeBuiltin("codegraph_callers"),
    ];
    const result = computeToolActivation(tools, defaultContext({ totalToolCount: tools.length }));
    expect(result.disabledTools.has("browser_navigate")).toBe(true);
    expect(result.disabledTools.has("read_file")).toBe(false);
  });

  // Rule 4: Research sub-agent
  it("disables write tools for research sub-agent", () => {
    const result = computeToolActivation(
      ALL_BUILTINS,
      defaultContext({ subAgentType: "research" }),
    );
    for (const name of ["write_file", "edit_file", "create_file", "delete_file"] as const) {
      expect(result.disabledTools.has(name)).toBe(true);
    }
    expect(result.disabledTools.has("run_terminal")).toBe(false);
    expect(result.disabledTools.has("read_file")).toBe(false);
  });

  // Rule 5: Verification sub-agent
  it("disables create/delete tools for verification sub-agent", () => {
    const result = computeToolActivation(
      ALL_BUILTINS,
      defaultContext({ subAgentType: "verification" }),
    );
    expect(result.disabledTools.has("write_file")).toBe(true);
    expect(result.disabledTools.has("create_file")).toBe(true);
    expect(result.disabledTools.has("delete_file")).toBe(true);
    expect(result.disabledTools.has("edit_file")).toBe(false);
    expect(result.disabledTools.has("read_file")).toBe(false);
  });

  // Rule 6: 15-tool cap trims lowest-priority MCP tools
  it("trims lowest-priority MCP tools when count exceeds 15", () => {
    const mcpTools = Array.from({ length: 8 }, (_, i) =>
      makeMcp(`tool_${i}`, 100 + i),
    );
    const allTools = [...ALL_BUILTINS, ...mcpTools];

    const result = computeToolActivation(
      allTools,
      defaultContext({ totalToolCount: allTools.length }),
    );

    // 10 builtins + 8 MCP = 18 total. Need to disable 3 MCP tools.
    // Highest priority numbers (107, 106, 105) should be disabled first.
    expect(result.disabledTools.has("mcp:tool_7")).toBe(true);
    expect(result.disabledTools.has("mcp:tool_6")).toBe(true);
    expect(result.disabledTools.has("mcp:tool_5")).toBe(true);
    expect(result.disabledTools.has("mcp:tool_4")).toBe(false);
    // All builtins remain enabled
    for (const tool of ALL_BUILTINS) {
      expect(result.disabledTools.has(tool.name)).toBe(false);
    }
  });

  it("never trims builtin tools even when count exceeds 15", () => {
    const mcpTools = Array.from({ length: 6 }, (_, i) =>
      makeMcp(`tool_${i}`, 100),
    );
    const allTools = [...ALL_BUILTINS, ...mcpTools]; // 16 total

    const result = computeToolActivation(
      allTools,
      defaultContext({ totalToolCount: allTools.length }),
    );

    for (const tool of ALL_BUILTINS) {
      expect(result.disabledTools.has(tool.name)).toBe(false);
    }
    // Only 1 MCP tool trimmed (16 - 15 = 1)
    const disabledMcp = mcpTools.filter((t) => result.disabledTools.has(t.name));
    expect(disabledMcp).toHaveLength(1);
    // No codegraph tools present, so the trim flag is false.
    expect(result.trimmedCodegraph).toBe(false);
  });

  // Rule 6 + gap 3.5.P3.I: codegraph_* tools are trimmed after MCP, and the
  // result reports it so the prompt builder can warn the agent.
  it("flags trimmedCodegraph when the cap trims codegraph_* tools", () => {
    const codegraph: DynamicToolMetadata[] = [
      "codegraph_search",
      "codegraph_context",
      "codegraph_trace",
      "codegraph_callers",
      "codegraph_callees",
      "codegraph_impact",
      "codegraph_node",
      "codegraph_explore",
    ].map((name) => ({
      name: name as DynamicToolMetadata["name"],
      description: name,
      parameters: {},
      source: "builtin" as const,
      priority: 0,
    }));
    // 10 core builtins + 8 codegraph = 18, no MCP -> trim 3, all from codegraph.
    const allTools = [...ALL_BUILTINS, ...codegraph];
    const result = computeToolActivation(
      allTools,
      defaultContext({ totalToolCount: allTools.length }),
    );
    expect(result.trimmedCodegraph).toBe(true);
    // Core builtins are never trimmed.
    for (const tool of ALL_BUILTINS) {
      expect(result.disabledTools.has(tool.name)).toBe(false);
    }
  });

  it("trimmedCodegraph is false when nothing is trimmed", () => {
    const result = computeToolActivation(ALL_BUILTINS, defaultContext());
    expect(result.trimmedCodegraph).toBe(false);
  });

  // Composition: multiple rules
  it("composes rules: network unavailable + read-only disables the union", () => {
    const result = computeToolActivation(
      ALL_BUILTINS,
      defaultContext({ networkAvailable: false, readOnlySession: true }),
    );
    const expectedDisabled = new Set([
      "web_search", "fetch_page",
      "write_file", "edit_file", "create_file", "delete_file", "run_terminal",
    ]);
    for (const name of expectedDisabled) {
      expect(result.disabledTools.has(name)).toBe(true);
    }
    expect(result.disabledTools.has("read_file")).toBe(false);
    expect(result.disabledTools.has("list_directory")).toBe(false);
    expect(result.disabledTools.has("grep_codebase")).toBe(false);
  });

  it("provides a reason string for each disabled tool", () => {
    const result = computeToolActivation(
      ALL_BUILTINS,
      defaultContext({ networkAvailable: false }),
    );
    expect(result.reasons.get("web_search")).toMatch(/Network/i);
    expect(result.reasons.get("fetch_page")).toMatch(/Network/i);
  });
});
