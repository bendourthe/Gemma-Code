import { describe, it, expect } from "vitest";
import { LazyToolLoader } from "../../../src/tools/LazyToolLoader.js";
import { TOOL_CATALOG } from "../../../src/tools/ToolCatalog.js";
import type { ToolMetadata } from "../../../src/tools/ToolCatalog.js";
import {
  serializeToolSummary,
  serializeToolDefinitions,
} from "../../../src/tools/Gemma4ToolFormat.js";

// The advertised TOOL_CATALOG no longer includes the lazy-loading helper
// tools (tail_output, grep_output, get_tool_schema) per v0.4.0 Phase 3.3.
// These tests exercise LazyToolLoader itself (deletion is Phase 7), so they
// build a synthetic catalog that still carries those entries.
const LEGACY_HELPER_TOOLS: readonly ToolMetadata[] = [
  {
    name: "tail_output",
    description: "Read the last N lines from a redirected tool output file.",
    parameters: {
      path: { type: "string", description: "Path to the redirected output file", required: true },
      lines: { type: "number", description: "Number of lines to read from the end (default 50)" },
    },
  },
  {
    name: "grep_output",
    description: "Search a redirected tool output file for a regex pattern.",
    parameters: {
      path: { type: "string", description: "Path to the redirected output file", required: true },
      pattern: { type: "string", description: "Regular expression pattern to search for", required: true },
      max_results: { type: "number", description: "Maximum matching lines to return (default 20)" },
    },
  },
  {
    name: "get_tool_schema",
    description: "Retrieve the full parameter schema for a tool by name.",
    parameters: {
      name: { type: "string", description: "Name of the tool to get the schema for", required: true },
    },
  },
];
const LAZY_LOADER_CATALOG: readonly ToolMetadata[] = [
  ...TOOL_CATALOG,
  ...LEGACY_HELPER_TOOLS,
];

describe("LazyToolLoader", () => {
  const loader = new LazyToolLoader(LAZY_LOADER_CATALOG);

  it("returns the full schema for a known tool", async () => {
    const result = await loader.execute({ name: "read_file" });
    expect(result.success).toBe(true);

    const schema = JSON.parse(result.output);
    expect(schema.name).toBe("read_file");
    expect(schema.description).toBeDefined();
    expect(schema.parameters).toBeDefined();
    expect(schema.parameters.path).toBeDefined();
    expect(schema.parameters.path.required).toBe(true);
  });

  it("returns schema with all parameter metadata", async () => {
    const result = await loader.execute({ name: "grep_codebase" });
    expect(result.success).toBe(true);

    const schema = JSON.parse(result.output);
    expect(schema.parameters.pattern.required).toBe(true);
    expect(schema.parameters.glob).toBeDefined();
    expect(schema.parameters.glob.required).toBe(false);
    expect(schema.parameters.max_results).toBeDefined();
  });

  it("returns error for unknown tool name", async () => {
    const result = await loader.execute({ name: "nonexistent_tool" });
    expect(result.success).toBe(false);
    expect(result.error).toContain("Unknown tool");
    expect(result.error).toContain("nonexistent_tool");
    expect(result.error).toContain("Available tools");
  });

  it("returns error when name parameter is missing", async () => {
    const result = await loader.execute({});
    expect(result.success).toBe(false);
    expect(result.error).toContain("name");
  });

  it("returns error when name parameter is empty", async () => {
    const result = await loader.execute({ name: "" });
    expect(result.success).toBe(false);
    expect(result.error).toContain("name");
  });

  it("can resolve get_tool_schema itself", async () => {
    const result = await loader.execute({ name: "get_tool_schema" });
    expect(result.success).toBe(true);

    const schema = JSON.parse(result.output);
    expect(schema.name).toBe("get_tool_schema");
    expect(schema.parameters.name.required).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe("serializeToolSummary", () => {
  it("includes get_tool_schema as a full <|tool> block", () => {
    const summary = serializeToolSummary(LAZY_LOADER_CATALOG);
    expect(summary).toContain("<|tool>");
    expect(summary).toContain("get_tool_schema");
    expect(summary).toContain("<tool|>");

    // Only one full tool block (the meta-tool).
    const toolOpenCount = (summary.match(/<\|tool>/g) ?? []).length;
    expect(toolOpenCount).toBe(1);
  });

  it("lists all other tools as markdown entries", () => {
    const summary = serializeToolSummary(LAZY_LOADER_CATALOG);
    expect(summary).toContain("**read_file**");
    expect(summary).toContain("**write_file**");
    expect(summary).toContain("**grep_codebase**");
    expect(summary).toContain("**run_terminal**");
    expect(summary).toContain("**tail_output**");
    expect(summary).toContain("**grep_output**");
  });

  it("includes instruction to call get_tool_schema first", () => {
    const summary = serializeToolSummary(LAZY_LOADER_CATALOG);
    expect(summary).toContain("Before using any tool");
    expect(summary).toContain("get_tool_schema");
  });

  it("achieves 40%+ token reduction vs full serialization", () => {
    const fullTokens = serializeToolDefinitions(LAZY_LOADER_CATALOG).length / 4;
    const summaryTokens = serializeToolSummary(LAZY_LOADER_CATALOG).length / 4;
    const reduction = 1 - summaryTokens / fullTokens;
    expect(reduction).toBeGreaterThanOrEqual(0.4);
  });

  it("does not include get_tool_schema in the markdown list", () => {
    const summary = serializeToolSummary(LAZY_LOADER_CATALOG);
    // get_tool_schema appears in the <|tool> block but not in the Available Tools list.
    const listSection = summary.split("## Available Tools")[1] ?? "";
    expect(listSection).not.toContain("**get_tool_schema**");
  });
});
