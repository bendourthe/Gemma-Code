/**
 * v1.2.0 Phase 3.5 -- integration test for the Coding-pillar wiring of the
 * 8 `codegraph_*` tools.
 *
 * Builds a real `ToolRegistry` via `buildToolRegistry`, points it at an
 * in-memory seeded `SqliteGraphStore`, and asserts:
 *
 *   1. The 8 codegraph tool names are registered.
 *   2. Catalog entries exist for every codegraph tool.
 *   3. Each tool is callable end-to-end and returns the structured JSON
 *      payload from `CodeGraphMcpServer`.
 *   4. The system prompt contains the "Prefer codegraph_*" hint when at
 *      least one codegraph tool is in the enabled set, and OMITS it when
 *      the codegraph wiring is absent.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildToolRegistry } from "../../../src/tools/ToolRegistryBuilder.js";
import { ConfirmationGate } from "../../../src/tools/ConfirmationGate.js";
import { TOOL_CATALOG, toDynamicMetadata } from "../../../src/tools/ToolCatalog.js";
import { BUILTIN_TOOL_NAMES } from "../../../src/tools/types.js";
import { PromptBuilder } from "../../../src/chat/PromptBuilder.js";
import { CodeGraphMcpServer } from "../../../core/codegraph/mcp/index.js";
import { SqliteGraphStore } from "../../../core/codegraph/store/index.js";
import { CODEGRAPH_TOOL_NAMES } from "../../../core/codegraph/manifest.js";

function makeTempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codegraph-wiring-"));
  return path.join(dir, "graph.db");
}

interface Harness {
  store: SqliteGraphStore;
  server: CodeGraphMcpServer;
  cleanup: () => void;
}

function setupHarness(): Harness {
  const dbPath = makeTempDbPath();
  const store = new SqliteGraphStore({ dbPath });
  const fileId = store.upsertFile({
    path: "src/redact.ts",
    language: "typescript",
    lastIndexedAt: 0,
    contentHash: "h",
  });
  const redactId = store.upsertSymbol({
    fileId,
    name: "redactSecrets",
    kind: "function",
    lineStart: 1,
    lineEnd: 10,
    signatureText: "function redactSecrets(input: string): string",
  });
  const handlerId = store.upsertSymbol({
    fileId,
    name: "handler",
    kind: "function",
    lineStart: 11,
    lineEnd: 20,
    signatureText: "function handler()",
  });
  store.upsertCallEdge({
    callerSymbolId: handlerId,
    calleeSymbolId: redactId,
    line: 14,
    kind: "call",
  });
  const server = new CodeGraphMcpServer({ store });
  return {
    store,
    server,
    cleanup() {
      store.close();
      try {
        fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
      } catch {
        // best-effort
      }
    },
  };
}

describe("Coding-pillar codegraph wiring", () => {
  let harness: Harness | null = null;

  beforeEach(() => {
    harness = null;
  });

  afterEach(() => {
    harness?.cleanup();
  });

  it("BUILTIN_TOOL_NAMES includes all 8 codegraph tool names", () => {
    for (const name of CODEGRAPH_TOOL_NAMES) {
      expect(BUILTIN_TOOL_NAMES).toContain(name);
    }
  });

  it("ToolCatalog has an entry for every codegraph tool", () => {
    for (const name of CODEGRAPH_TOOL_NAMES) {
      const entry = TOOL_CATALOG.find((t) => t.name === name);
      expect(entry, `catalog entry missing for ${name}`).toBeDefined();
    }
  });

  it("buildToolRegistry registers the 8 codegraph tools when codegraph wiring is provided", () => {
    harness = setupHarness();
    const gate = new ConfirmationGate({ requireConfirmation: false } as never);
    const registry = buildToolRegistry({
      gate,
      editMode: "auto",
      secretPathDenyExtra: [],
      toolOutputCache: null,
      webResponseCache: null,
      codegraph: { resolveServer: () => harness!.server },
    });
    for (const name of CODEGRAPH_TOOL_NAMES) {
      expect(registry.has(name), `registry missing ${name}`).toBe(true);
    }
  });

  it("each codegraph tool returns the structured JSON payload from the server", async () => {
    harness = setupHarness();
    const gate = new ConfirmationGate({ requireConfirmation: false } as never);
    const registry = buildToolRegistry({
      gate,
      editMode: "auto",
      secretPathDenyExtra: [],
      toolOutputCache: null,
      webResponseCache: null,
      codegraph: { resolveServer: () => harness!.server },
    });

    const callersHandler = await registry.resolveLazy("codegraph_callers");
    expect(callersHandler).toBeDefined();
    const callersResult = await callersHandler!.execute({ symbolName: "redactSecrets" });
    expect(callersResult.success).toBe(true);
    const callersPayload = JSON.parse(callersResult.output);
    expect(callersPayload.callers.length).toBe(1);
    expect(callersPayload.callers[0].symbolName).toBe("handler");

    const searchHandler = await registry.resolveLazy("codegraph_search");
    const searchResult = await searchHandler!.execute({ query: "redact" });
    expect(searchResult.success).toBe(true);
    const searchPayload = JSON.parse(searchResult.output);
    expect(searchPayload.hits.map((h: any) => h.name)).toContain("redactSecrets");
  });

  it("system prompt includes the Prefer codegraph_* hint when codegraph tools are enabled", () => {
    const builder = new PromptBuilder();
    const enabledTools = TOOL_CATALOG.filter((t) =>
      t.name === "grep_codebase" ||
      t.name === "codegraph_callers" ||
      t.name === "codegraph_search",
    ).map(toDynamicMetadata);
    const prompt = builder.build({
      modelName: "test",
      maxTokens: 8000,
      planModeActive: false,
      thinkingMode: false,
      enabledTools,
      promptStyle: "concise",
    });
    expect(prompt).toMatch(/Code-graph preference/);
    expect(prompt).toMatch(/Prefer the `codegraph_\*` tools/);
  });

  it("system prompt omits the hint when no codegraph tool is enabled", () => {
    const builder = new PromptBuilder();
    const enabledTools = TOOL_CATALOG.filter((t) => t.name === "grep_codebase").map(
      toDynamicMetadata,
    );
    const prompt = builder.build({
      modelName: "test",
      maxTokens: 8000,
      planModeActive: false,
      thinkingMode: false,
      enabledTools,
      promptStyle: "concise",
    });
    expect(prompt).not.toMatch(/Code-graph preference/);
  });
});
