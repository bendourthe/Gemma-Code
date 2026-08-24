/**
 * E2E: sub-agent activation rules.
 *
 * Verifies that ToolActivationRules correctly scope sub-agent tool access
 * and enforce the 20-tool cap. Full sub-agent runs require Ollama and are
 * covered in unit tests.
 */

import { describe, it, expect } from "vitest";
import { computeToolActivation } from "../../../src/tools/ToolActivationRules.js";
import { TOOL_CATALOG, toDynamicMetadata } from "../../../src/tools/ToolCatalog.js";
import type { DynamicToolMetadata } from "../../../src/tools/ToolCatalog.js";
import type { ToolName } from "../../../src/tools/types.js";

function enabledNames(
  allTools: readonly DynamicToolMetadata[],
  result: ReturnType<typeof computeToolActivation>,
): ToolName[] {
  return allTools
    .filter((t) => !result.disabledTools.has(t.name))
    .map((t) => t.name);
}

describe("e2e: sub-agent tool activation", () => {
  it("verification sub-agent disables write_file", () => {
    const allTools = TOOL_CATALOG.map(toDynamicMetadata);
    const result = computeToolActivation(allTools, {
      ollamaReachable: true,
      networkAvailable: true,
      readOnlySession: false,
      subAgentType: "verification",
      totalToolCount: allTools.length,
    });
    expect(result.disabledTools.has("write_file")).toBe(true);
  });

  it("research sub-agent still allows read_file + web_search + fetch_page", () => {
    const allTools = TOOL_CATALOG.map(toDynamicMetadata);
    const result = computeToolActivation(allTools, {
      ollamaReachable: true,
      networkAvailable: true,
      readOnlySession: false,
      subAgentType: "research",
      totalToolCount: allTools.length,
    });
    expect(result.disabledTools.has("read_file")).toBe(false);
    expect(result.disabledTools.has("web_search")).toBe(false);
    expect(result.disabledTools.has("fetch_page")).toBe(false);
  });

  it("20-tool cap is applied when catalog exceeds 20 entries", () => {
    const base = TOOL_CATALOG.map(toDynamicMetadata);
    const padded: DynamicToolMetadata[] = [
      ...base,
      ...Array.from({ length: 20 }, (_, i) => ({
        ...base[0]!,
        name: `mcp:fake_${i}` as ToolName,
        source: "mcp" as const,
      })),
    ];
    const result = computeToolActivation(padded, {
      ollamaReachable: true,
      networkAvailable: true,
      readOnlySession: false,
      subAgentType: null,
      totalToolCount: padded.length,
    });
    const enabled = enabledNames(padded, result);
    expect(enabled.length).toBeLessThanOrEqual(20);
  });

  it("network unavailable disables fetch_page and web_search", () => {
    const allTools = TOOL_CATALOG.map(toDynamicMetadata);
    const result = computeToolActivation(allTools, {
      ollamaReachable: true,
      networkAvailable: false,
      readOnlySession: false,
      subAgentType: null,
      totalToolCount: allTools.length,
    });
    expect(result.disabledTools.has("fetch_page")).toBe(true);
    expect(result.disabledTools.has("web_search")).toBe(true);
  });

  it("read-only session disables write_file", () => {
    const allTools = TOOL_CATALOG.map(toDynamicMetadata);
    const result = computeToolActivation(allTools, {
      ollamaReachable: true,
      networkAvailable: true,
      readOnlySession: true,
      subAgentType: null,
      totalToolCount: allTools.length,
    });
    expect(result.disabledTools.has("write_file")).toBe(true);
  });

  it("ollama unreachable disables every tool", () => {
    const allTools = TOOL_CATALOG.map(toDynamicMetadata);
    const result = computeToolActivation(allTools, {
      ollamaReachable: false,
      networkAvailable: true,
      readOnlySession: false,
      subAgentType: null,
      totalToolCount: allTools.length,
    });
    expect(result.disabledTools.size).toBe(allTools.length);
  });
});
