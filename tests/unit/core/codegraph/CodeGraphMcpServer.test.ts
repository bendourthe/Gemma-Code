/**
 * v1.2.0 Phase 3.4 -- integration tests for the in-process MCP server.
 *
 * Tests cover the 8 tool surface end-to-end against a real
 * `SqliteGraphStore`; the server runs in-process so we assert the surface
 * by direct calls to `listTools` / `invokeTool` rather than by spawning a
 * subprocess.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CODEGRAPH_MCP_SERVER_ID,
  CodeGraphMcpServer,
} from "../../../../core/codegraph/mcp/index.js";
import { SqliteGraphStore } from "../../../../core/codegraph/store/index.js";
import { CODEGRAPH_TOOL_NAMES } from "../../../../core/codegraph/manifest.js";

function makeTempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codegraph-mcp-"));
  return path.join(dir, "graph.db");
}

interface ParsedResult {
  ok: boolean;
  toolName: string;
  data: any;
}

async function call(
  server: CodeGraphMcpServer,
  name: string,
  args: Record<string, unknown>,
): Promise<ParsedResult> {
  const r = await server.invokeTool(name, args);
  return {
    ok: r.ok,
    toolName: r.toolName,
    data: r.result ? JSON.parse(r.result) : { error: r.error },
  };
}

describe("CodeGraphMcpServer", () => {
  let dbPath: string;
  let store: SqliteGraphStore;
  let server: CodeGraphMcpServer;
  let fileId: number;

  beforeEach(() => {
    dbPath = makeTempDbPath();
    store = new SqliteGraphStore({ dbPath });
    server = new CodeGraphMcpServer({ store });

    // Seed a small graph fixture: caller -> middle -> leaf, plus an
    // unrelated `helper` symbol so listFiles returns >1 file.
    fileId = store.upsertFile({
      path: "src/seed.ts",
      language: "typescript",
      lastIndexedAt: 0,
      contentHash: "h",
    });
    const file2 = store.upsertFile({
      path: "src/other.ts",
      language: "typescript",
      lastIndexedAt: 0,
      contentHash: "h2",
    });
    const callerId = store.upsertSymbol({
      fileId,
      name: "caller",
      kind: "function",
      lineStart: 1,
      lineEnd: 10,
      signatureText: "function caller()",
    });
    const middleId = store.upsertSymbol({
      fileId,
      name: "middle",
      kind: "function",
      lineStart: 11,
      lineEnd: 20,
      signatureText: "function middle()",
    });
    const leafId = store.upsertSymbol({
      fileId,
      name: "leaf",
      kind: "function",
      lineStart: 21,
      lineEnd: 25,
      signatureText: "function leaf()",
    });
    store.upsertSymbol({
      fileId: file2,
      name: "helper",
      kind: "function",
      lineStart: 1,
      lineEnd: 3,
      signatureText: "function helper()",
    });
    store.upsertCallEdge({ callerSymbolId: callerId, calleeSymbolId: middleId, line: 5, kind: "call" });
    store.upsertCallEdge({ callerSymbolId: middleId, calleeSymbolId: leafId, line: 15, kind: "call" });
  });

  afterEach(() => {
    store.close();
    try {
      fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
    } catch {
      // best-effort
    }
  });

  it("listTools returns the 8 names from the manifest", () => {
    const tools = server.listTools();
    expect(tools.length).toBe(CODEGRAPH_TOOL_NAMES.length);
    expect(tools.map((t) => t.name).sort()).toEqual([...CODEGRAPH_TOOL_NAMES].sort());
    for (const tool of tools) {
      expect(tool.serverId).toBe(CODEGRAPH_MCP_SERVER_ID);
      const parsed = JSON.parse(tool.inputSchema);
      expect(parsed.type).toBe("object");
    }
  });

  it("invokeTool rejects unknown tool names", async () => {
    const r = await server.invokeTool("not_a_tool", {});
    expect(r.ok).toBe(false);
    expect(r.error).toContain("Unknown codegraph tool");
  });

  it("codegraph_search finds seeded symbols", async () => {
    const r = await call(server, "codegraph_search", { query: "middle" });
    expect(r.ok).toBe(true);
    expect(r.data.hits.map((h: any) => h.name)).toContain("middle");
  });

  it("codegraph_callers returns the direct caller", async () => {
    const r = await call(server, "codegraph_callers", { symbolName: "middle" });
    expect(r.ok).toBe(true);
    expect(r.data.callers[0].symbolName).toBe("caller");
  });

  it("codegraph_callees returns the direct callee", async () => {
    const r = await call(server, "codegraph_callees", { symbolName: "middle" });
    expect(r.ok).toBe(true);
    expect(r.data.callees[0].symbolName).toBe("leaf");
  });

  it("codegraph_context bundles caller + callee for a symbol", async () => {
    const r = await call(server, "codegraph_context", { symbolName: "middle" });
    expect(r.ok).toBe(true);
    expect(r.data.symbol.name).toBe("middle");
    expect(r.data.callers.length).toBe(1);
    expect(r.data.callees.length).toBe(1);
  });

  it("codegraph_node returns raw metadata", async () => {
    const r = await call(server, "codegraph_node", { symbolName: "leaf" });
    expect(r.ok).toBe(true);
    expect(r.data.symbols[0].filePath).toBe("src/seed.ts");
    expect(r.data.symbols[0].lineStart).toBe(21);
  });

  it("codegraph_trace finds the caller -> leaf path", async () => {
    const r = await call(server, "codegraph_trace", {
      fromSymbol: "caller",
      toSymbol: "leaf",
      maxDepth: 5,
    });
    expect(r.ok).toBe(true);
    expect(r.data.edges.length).toBe(2);
    expect(r.data.edges[0].toSymbolName).toBe("middle");
    expect(r.data.edges[1].toSymbolName).toBe("leaf");
  });

  it("codegraph_impact returns direct + transitive callers", async () => {
    const r = await call(server, "codegraph_impact", { symbolName: "leaf", maxDepth: 3 });
    expect(r.ok).toBe(true);
    expect(r.data.directCallers.map((c: any) => c.symbolName)).toContain("middle");
    expect(r.data.transitiveCallers.map((c: any) => c.symbolName)).toContain("caller");
    expect(r.data.impactRadius).toBeGreaterThanOrEqual(2);
  });

  it("codegraph_explore returns multiple context bundles", async () => {
    const r = await call(server, "codegraph_explore", {
      symbolNames: ["middle", "leaf", "does_not_exist"],
    });
    expect(r.ok).toBe(true);
    expect(r.data.contexts.length).toBe(2);
    expect(r.data.contexts.map((c: any) => c.symbol.name).sort()).toEqual(["leaf", "middle"]);
  });

  it("codegraph_files lists every file present in the graph", async () => {
    const r = await call(server, "codegraph_files", {});
    expect(r.ok).toBe(true);
    expect(r.data.files.length).toBe(2);
    expect(r.data.files.map((f: any) => f.path).sort()).toEqual([
      "src/other.ts",
      "src/seed.ts",
    ]);
  });

  it("missing required args yields a clean error", async () => {
    const r = await server.invokeTool("codegraph_callers", {});
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/symbolName/);
  });
});
