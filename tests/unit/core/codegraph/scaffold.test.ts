/**
 * v1.2.0 Phase 3.1 -- scaffold smoke test.
 *
 * Imports the public surface and asserts the manifest's invariants. If
 * `tsconfig.json` paths drift or the four subpackages stop exporting their
 * symbols, this test fails before any of the heavier Phase 3 tests run.
 */

import { describe, it, expect } from "vitest";
import {
  CODEGRAPH_MANIFEST,
  CODEGRAPH_SCHEMA_VERSION,
  CODEGRAPH_SUPPORTED_LANGUAGES,
  CODEGRAPH_TOOL_NAMES,
} from "../../../../core/codegraph/manifest.js";
import { SqliteGraphStore } from "../../../../core/codegraph/store/index.js";
import { RepoScanner } from "../../../../core/codegraph/scanner/index.js";
import { CodeGraphMcpServer } from "../../../../core/codegraph/mcp/index.js";

describe("core/codegraph scaffold", () => {
  it("manifest exposes the expected schema version", () => {
    expect(CODEGRAPH_SCHEMA_VERSION).toBe("1.0.0");
    expect(CODEGRAPH_MANIFEST.schemaVersion).toBe(CODEGRAPH_SCHEMA_VERSION);
  });

  it("manifest lists the four supported languages in order", () => {
    expect([...CODEGRAPH_SUPPORTED_LANGUAGES]).toEqual([
      "typescript",
      "python",
      "rust",
      "go",
    ]);
  });

  it("manifest enumerates the 8 MCP tool names per the plan", () => {
    expect([...CODEGRAPH_TOOL_NAMES]).toEqual([
      "codegraph_search",
      "codegraph_context",
      "codegraph_trace",
      "codegraph_callers",
      "codegraph_callees",
      "codegraph_impact",
      "codegraph_node",
      "codegraph_explore",
      "codegraph_files",
    ]);
  });

  it("store / scanner / mcp classes are exported from the barrel", () => {
    expect(typeof SqliteGraphStore).toBe("function");
    expect(typeof RepoScanner).toBe("function");
    expect(typeof CodeGraphMcpServer).toBe("function");
  });
});
