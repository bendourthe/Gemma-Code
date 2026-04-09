import { describe, it, expect } from "vitest";
import { TOOL_CATALOG } from "../../../src/tools/ToolCatalog.js";
import { TOOL_NAMES } from "../../../src/tools/types.js";

describe("TOOL_CATALOG", () => {
  it("contains exactly 10 entries", () => {
    expect(TOOL_CATALOG).toHaveLength(10);
  });

  it("every entry name matches a value from TOOL_NAMES", () => {
    for (const tool of TOOL_CATALOG) {
      expect(TOOL_NAMES).toContain(tool.name);
    }
  });

  it("covers every value in TOOL_NAMES", () => {
    const catalogNames = new Set(TOOL_CATALOG.map((t) => t.name));
    for (const name of TOOL_NAMES) {
      expect(catalogNames.has(name)).toBe(true);
    }
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
