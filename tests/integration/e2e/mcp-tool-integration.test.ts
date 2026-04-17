/**
 * E2E: MCP tool integration with ToolRegistry.
 *
 * Verifies that MCP-provided tools register cleanly alongside built-ins,
 * can execute via the registry, and count toward the 15-tool activation
 * cap. No actual MCP server process is required.
 */

import { describe, it, expect } from "vitest";
import { ToolRegistry } from "../../../src/tools/ToolRegistry.js";
import { computeToolActivation } from "../../../src/tools/ToolActivationRules.js";
import { TOOL_CATALOG, toDynamicMetadata } from "../../../src/tools/ToolCatalog.js";
import type { DynamicToolMetadata } from "../../../src/tools/ToolCatalog.js";
import type { ToolHandler, ToolName } from "../../../src/tools/types.js";

describe("e2e: MCP tool integration", () => {
  it("MCP tool registers and is returned as enabled", async () => {
    const registry = new ToolRegistry();
    const mcpHandler: ToolHandler = {
      execute: async (parameters) => ({
        id: "tc-mcp",
        success: true,
        output: `mcp lookup: ${JSON.stringify(parameters)}`,
      }),
    };
    registry.register("mcp:lookup_docs" as ToolName, mcpHandler);
    expect(registry.has("mcp:lookup_docs" as ToolName)).toBe(true);
    expect(registry.isEnabled("mcp:lookup_docs" as ToolName)).toBe(true);
    const result = await registry.execute({
      tool: "mcp:lookup_docs" as ToolName,
      id: "tc-mcp",
      parameters: { query: "typescript generics" },
    });
    expect(result.success).toBe(true);
    expect(result.output).toContain("mcp lookup");
  });

  it("15-tool cap enforces on a mixed built-in + MCP catalog", () => {
    const builtIns = TOOL_CATALOG.map(toDynamicMetadata);
    const mcpTools: DynamicToolMetadata[] = Array.from({ length: 20 }, (_, i) => ({
      ...builtIns[0]!,
      name: `mcp:server_a.tool_${i}` as ToolName,
      source: "mcp" as const,
    }));
    const mixed = [...builtIns, ...mcpTools];

    const result = computeToolActivation(mixed, {
      ollamaReachable: true,
      networkAvailable: true,
      readOnlySession: false,
      subAgentType: null,
      totalToolCount: mixed.length,
    });
    const enabledCount = mixed.length - result.disabledTools.size;
    expect(enabledCount).toBeLessThanOrEqual(15);
  });

  it("disables MCP tools preferentially over built-ins when applying the cap", () => {
    const builtIns = TOOL_CATALOG.map(toDynamicMetadata).slice(0, 14);
    const mcpTools: DynamicToolMetadata[] = [
      { ...builtIns[0]!, name: "mcp:a" as ToolName, source: "mcp" },
      { ...builtIns[0]!, name: "mcp:b" as ToolName, source: "mcp" },
    ];
    const mixed = [...builtIns, ...mcpTools];

    const result = computeToolActivation(mixed, {
      ollamaReachable: true,
      networkAvailable: true,
      readOnlySession: false,
      subAgentType: null,
      totalToolCount: mixed.length,
    });
    const disabledBuiltins = builtIns.filter((t) =>
      result.disabledTools.has(t.name),
    );
    // None of the 14 built-ins should be disabled.
    expect(disabledBuiltins.length).toBe(0);
  });
});
