import { describe, it, expect } from "vitest";
import { TOOL_CATALOG } from "../../../src/tools/ToolCatalog.js";
import { TOOL_NAMES } from "../../../src/tools/types.js";

describe("TOOL_CATALOG", () => {
  it("contains exactly 24 entries (advertised tools only)", () => {
    // v0.7.0 Phase 3 added compress_range + compress_message, both
    // permission-tier 0 model-callable compression tools.
    // v0.7.0 Phase 4.4 added update_todos, also permission-tier 0.
    // v1.2.0 Phase 3.5 added 9 codegraph_* tools (search / context / trace /
    // callers / callees / impact / node / explore / files); they ride the
    // 15-tool cap as trim candidates after MCP tools.
    // v1.2.0 Phase 6.2 added 2 lsp_* tools (lsp_definition, lsp_references);
    // they share the permission-tier 0 + trim-candidate posture with the
    // codegraph surface.
    expect(TOOL_CATALOG).toHaveLength(24);
  });

  it("every entry name matches a value from TOOL_NAMES", () => {
    for (const tool of TOOL_CATALOG) {
      expect(TOOL_NAMES).toContain(tool.name);
    }
  });

  it("does not advertise unregistered helper tools (tail_output, grep_output)", () => {
    const catalogNames = new Set(TOOL_CATALOG.map((t) => t.name));
    expect(catalogNames.has("tail_output" as never)).toBe(false);
    expect(catalogNames.has("grep_output" as never)).toBe(false);
  });

  it("every entry has a non-empty description", () => {
    for (const tool of TOOL_CATALOG) {
      expect(tool.description.length).toBeGreaterThan(0);
    }
  });

  it("every entry has at least one parameter defined", () => {
    for (const tool of TOOL_CATALOG) {
      expect(Object.keys(tool.parameters).length).toBeGreaterThan(0);
    }
  });

  it("every parameter has a type and description", () => {
    for (const tool of TOOL_CATALOG) {
      for (const [, param] of Object.entries(tool.parameters)) {
        expect(param.type.length).toBeGreaterThan(0);
        expect(param.description.length).toBeGreaterThan(0);
      }
    }
  });
});
