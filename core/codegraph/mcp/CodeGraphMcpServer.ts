/**
 * v1.2.0 Phase 3.4 -- in-process MCP server for the code graph.
 *
 * Exposes exactly the 8 tools enumerated by the plan's Phase 3.4 prompt and
 * the `CODEGRAPH_TOOL_NAMES` manifest constant. The server implements the
 * `McpHarnessAdapter` contract from `core/coding/McpBridge.ts` so the
 * daemon's MCP harness can register it next to external stdio MCP servers.
 *
 * The server runs **in-process** -- it never spawns a child process, never
 * opens a socket, and never binds a network port. Tests cover this by
 * asserting no listening sockets appear at instantiation.
 *
 * v1.4.0 Phase 8 (gap 3.4.P3.H, CLOSED won't-do): the gap asked whether to
 * also expose this graph over a read-only stdio MCP transport for external
 * consumers. We deliberately keep it in-process only: no current consumer is
 * external (the daemon registers it directly via `McpHarnessAdapter`), a stdio
 * transport would re-introduce the child-process / socket surface this design
 * explicitly avoids, and the local-first contract favours the in-process path.
 * Reopen as a fresh cycle item if an out-of-process consumer ever appears.
 */

import type {
  McpHarnessAdapter,
  McpInvokeResult,
  McpToolDescriptor,
} from "../../coding/McpBridge.js";
import {
  CODEGRAPH_TOOL_NAMES,
  type CodeGraphToolName,
} from "../manifest.js";
import type { SqliteGraphStore } from "../store/index.js";
import type {
  ExploreReport,
  FilesListing,
  ImpactReport,
  SymbolContext,
  SymbolReference,
  SymbolSearchHit,
  TraceEdge,
  TracePath,
} from "../types.js";

export const CODEGRAPH_MCP_SERVER_ID = "nexus.codegraph" as const;

export interface CodeGraphMcpServerOptions {
  readonly store: SqliteGraphStore;
}

const TOOL_DESCRIPTIONS: Record<CodeGraphToolName, string> = {
  codegraph_search:
    "Full-text search across indexed symbol names and signatures. Args: { query: string, limit?: number }.",
  codegraph_context:
    "Resolve a symbol and return its definition plus direct callers and callees. Args: { symbolName: string, depth?: number }.",
  codegraph_trace:
    "Find a path of call edges from one symbol to another (best-effort, bounded by `maxDepth`). Args: { fromSymbol: string, toSymbol: string, maxDepth?: number }.",
  codegraph_callers:
    "List symbols that call the named target. Args: { symbolName: string }.",
  codegraph_callees:
    "List symbols called by the named source. Args: { symbolName: string }.",
  codegraph_impact:
    "Compute the transitive caller closure for the named symbol; useful before signature changes. Args: { symbolName: string, maxDepth?: number }.",
  codegraph_node:
    "Return raw symbol metadata for the named target. Args: { symbolName: string }.",
  codegraph_explore:
    "Bulk-resolve context bundles for an array of symbol names. Args: { symbolNames: string[] }.",
  codegraph_files:
    "List every file currently present in the graph (path + language + last-indexed timestamp). No args.",
};

/** JSON-Schema (string-encoded) for every codegraph tool. */
const TOOL_INPUT_SCHEMAS: Record<CodeGraphToolName, string> = {
  codegraph_search: JSON.stringify({
    type: "object",
    properties: {
      query: { type: "string", description: "FTS5 query (bareword tokens get prefix matching applied)." },
      limit: { type: "number", description: "Max hits (default 50)." },
    },
    required: ["query"],
    additionalProperties: false,
  }),
  codegraph_context: JSON.stringify({
    type: "object",
    properties: {
      symbolName: { type: "string" },
      depth: { type: "number", description: "Currently unused (placeholder for multi-hop expansion)." },
    },
    required: ["symbolName"],
    additionalProperties: false,
  }),
  codegraph_trace: JSON.stringify({
    type: "object",
    properties: {
      fromSymbol: { type: "string" },
      toSymbol: { type: "string" },
      maxDepth: { type: "number", description: "Search depth cap (default 5)." },
    },
    required: ["fromSymbol", "toSymbol"],
    additionalProperties: false,
  }),
  codegraph_callers: JSON.stringify({
    type: "object",
    properties: { symbolName: { type: "string" } },
    required: ["symbolName"],
    additionalProperties: false,
  }),
  codegraph_callees: JSON.stringify({
    type: "object",
    properties: { symbolName: { type: "string" } },
    required: ["symbolName"],
    additionalProperties: false,
  }),
  codegraph_impact: JSON.stringify({
    type: "object",
    properties: {
      symbolName: { type: "string" },
      maxDepth: { type: "number", description: "Transitive closure depth (default 3)." },
    },
    required: ["symbolName"],
    additionalProperties: false,
  }),
  codegraph_node: JSON.stringify({
    type: "object",
    properties: { symbolName: { type: "string" } },
    required: ["symbolName"],
    additionalProperties: false,
  }),
  codegraph_explore: JSON.stringify({
    type: "object",
    properties: {
      symbolNames: { type: "array", items: { type: "string" } },
    },
    required: ["symbolNames"],
    additionalProperties: false,
  }),
  codegraph_files: JSON.stringify({
    type: "object",
    properties: {},
    additionalProperties: false,
  }),
};

export class CodeGraphMcpServer implements McpHarnessAdapter {
  private readonly _store: SqliteGraphStore;

  constructor(opts: CodeGraphMcpServerOptions) {
    this._store = opts.store;
  }

  listTools(): readonly McpToolDescriptor[] {
    return Object.freeze(
      CODEGRAPH_TOOL_NAMES.map((name) =>
        Object.freeze({
          name,
          description: TOOL_DESCRIPTIONS[name],
          inputSchema: TOOL_INPUT_SCHEMAS[name],
          serverId: CODEGRAPH_MCP_SERVER_ID,
        }),
      ),
    );
  }

  async invokeTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<McpInvokeResult> {
    if (!CODEGRAPH_TOOL_NAMES.includes(name as CodeGraphToolName)) {
      return {
        ok: false,
        toolName: name,
        error: `Unknown codegraph tool: ${name}`,
      };
    }
    try {
      const result = this._dispatch(name as CodeGraphToolName, args);
      return {
        ok: true,
        toolName: name,
        result: JSON.stringify(result),
      };
    } catch (err) {
      return {
        ok: false,
        toolName: name,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private _dispatch(name: CodeGraphToolName, args: Record<string, unknown>): unknown {
    switch (name) {
      case "codegraph_search":
        return this._search(args);
      case "codegraph_context":
        return this._context(args);
      case "codegraph_trace":
        return this._trace(args);
      case "codegraph_callers":
        return this._callers(args);
      case "codegraph_callees":
        return this._callees(args);
      case "codegraph_impact":
        return this._impact(args);
      case "codegraph_node":
        return this._node(args);
      case "codegraph_explore":
        return this._explore(args);
      case "codegraph_files":
        return this._files();
    }
  }

  private _requireString(args: Record<string, unknown>, key: string): string {
    const v = args[key];
    if (typeof v !== "string" || v.length === 0) {
      throw new Error(`Missing or empty string argument: ${key}`);
    }
    return v;
  }

  private _optionalNumber(args: Record<string, unknown>, key: string, fallback: number): number {
    const v = args[key];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    return fallback;
  }

  private _search(args: Record<string, unknown>): { hits: readonly SymbolSearchHit[] } {
    const query = this._requireString(args, "query");
    const limit = Math.max(1, Math.min(this._optionalNumber(args, "limit", 50), 500));
    const hits = this._store.searchSymbols(this._withPrefixMatching(query), limit);
    return { hits };
  }

  private _context(args: Record<string, unknown>): SymbolContext | { error: string } {
    const symbolName = this._requireString(args, "symbolName");
    const matches = this._store.findSymbolByName(symbolName);
    const primary = matches[0];
    if (!primary) {
      return { error: `Symbol not found: ${symbolName}` };
    }
    const file = this._store
      .listFiles()
      .find((f) => f.id === primary.fileId);
    const symbolHit: SymbolSearchHit = {
      id: primary.id,
      name: primary.name,
      kind: primary.kind,
      filePath: file?.path ?? "<unknown>",
      lineStart: primary.lineStart,
      lineEnd: primary.lineEnd,
      signaturePreview: primary.signatureText.slice(0, 200),
    };
    return {
      symbol: symbolHit,
      callers: this._store.findCallersOf(symbolName),
      callees: this._store.findCalleesOf(symbolName),
    };
  }

  private _callers(args: Record<string, unknown>): { callers: readonly SymbolReference[] } {
    const name = this._requireString(args, "symbolName");
    return { callers: this._store.findCallersOf(name) };
  }

  private _callees(args: Record<string, unknown>): { callees: readonly SymbolReference[] } {
    const name = this._requireString(args, "symbolName");
    return { callees: this._store.findCalleesOf(name) };
  }

  private _node(args: Record<string, unknown>): {
    symbols: ReadonlyArray<{
      readonly id: number;
      readonly name: string;
      readonly kind: string;
      readonly filePath: string;
      readonly lineStart: number;
      readonly lineEnd: number;
      readonly signatureText: string;
    }>;
  } {
    const name = this._requireString(args, "symbolName");
    const matches = this._store.findSymbolByName(name);
    const files = this._store.listFiles();
    const byFileId = new Map(files.map((f) => [f.id, f.path] as const));
    return {
      symbols: matches.map((s) =>
        Object.freeze({
          id: s.id,
          name: s.name,
          kind: s.kind,
          filePath: byFileId.get(s.fileId) ?? "<unknown>",
          lineStart: s.lineStart,
          lineEnd: s.lineEnd,
          signatureText: s.signatureText,
        }),
      ),
    };
  }

  private _trace(args: Record<string, unknown>): TracePath | { error: string } {
    const fromSymbol = this._requireString(args, "fromSymbol");
    const toSymbol = this._requireString(args, "toSymbol");
    const maxDepth = Math.max(1, Math.min(this._optionalNumber(args, "maxDepth", 5), 12));
    const edges = this._bfsTrace(fromSymbol, toSymbol, maxDepth);
    if (edges === null) {
      return { error: `No path from ${fromSymbol} to ${toSymbol} within depth ${maxDepth}.` };
    }
    return { edges };
  }

  private _impact(args: Record<string, unknown>): ImpactReport | { error: string } {
    const symbolName = this._requireString(args, "symbolName");
    const maxDepth = Math.max(1, Math.min(this._optionalNumber(args, "maxDepth", 3), 10));
    const matches = this._store.findSymbolByName(symbolName);
    const primary = matches[0];
    if (!primary) return { error: `Symbol not found: ${symbolName}` };
    const direct = this._store.findCallersOf(symbolName);
    const transitive = this._transitiveCallers(symbolName, maxDepth);
    const files = this._store.listFiles();
    const byFileId = new Map(files.map((f) => [f.id, f.path] as const));
    return {
      symbol: {
        id: primary.id,
        name: primary.name,
        kind: primary.kind,
        filePath: byFileId.get(primary.fileId) ?? "<unknown>",
        lineStart: primary.lineStart,
        lineEnd: primary.lineEnd,
        signaturePreview: primary.signatureText.slice(0, 200),
      },
      directCallers: direct,
      transitiveCallers: transitive,
      impactRadius: transitive.length,
    };
  }

  private _explore(args: Record<string, unknown>): ExploreReport {
    const raw = args["symbolNames"];
    if (!Array.isArray(raw)) {
      throw new Error("symbolNames must be an array of strings");
    }
    const contexts: SymbolContext[] = [];
    for (const entry of raw) {
      if (typeof entry !== "string" || entry.length === 0) continue;
      const ctx = this._context({ symbolName: entry });
      if ("symbol" in ctx) contexts.push(ctx);
    }
    return { contexts };
  }

  private _files(): FilesListing {
    return { files: this._store.listFiles() };
  }

  /**
   * Heuristic: for a single bareword query (no operators / quotes), apply
   * an FTS5 prefix match so the agent's natural queries ("redact",
   * "tokenize") still surface symbols with longer names.
   */
  private _withPrefixMatching(query: string): string {
    const trimmed = query.trim();
    if (trimmed.length === 0) return "*";
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) {
      return `${trimmed}*`;
    }
    return trimmed;
  }

  private _bfsTrace(
    from: string,
    to: string,
    maxDepth: number,
  ): readonly TraceEdge[] | null {
    if (from === to) return [];
    interface Node {
      readonly name: string;
      readonly path: readonly TraceEdge[];
    }
    const seen = new Set<string>([from]);
    let frontier: Node[] = [{ name: from, path: [] }];
    for (let depth = 0; depth < maxDepth; depth += 1) {
      const next: Node[] = [];
      for (const node of frontier) {
        const callees = this._store.findCalleesOf(node.name);
        for (const c of callees) {
          if (seen.has(c.symbolName)) continue;
          seen.add(c.symbolName);
          // Build the edge -- we don't have the caller's id here directly;
          // pull from the symbol store.
          const callerMatches = this._store.findSymbolByName(node.name);
          const callerId = callerMatches[0]?.id ?? -1;
          const edge: TraceEdge = {
            fromSymbolId: callerId,
            fromSymbolName: node.name,
            toSymbolId: c.symbolId,
            toSymbolName: c.symbolName,
            line: c.lineStart,
          };
          const newPath = [...node.path, edge];
          if (c.symbolName === to) return newPath;
          next.push({ name: c.symbolName, path: newPath });
        }
      }
      if (next.length === 0) return null;
      frontier = next;
    }
    return null;
  }

  private _transitiveCallers(
    symbolName: string,
    maxDepth: number,
  ): readonly SymbolReference[] {
    const seen = new Set<string>([symbolName]);
    const collected: SymbolReference[] = [];
    let frontier = [symbolName];
    for (let depth = 0; depth < maxDepth; depth += 1) {
      const next: string[] = [];
      for (const name of frontier) {
        const callers = this._store.findCallersOf(name);
        for (const c of callers) {
          if (seen.has(c.symbolName)) continue;
          seen.add(c.symbolName);
          collected.push(c);
          next.push(c.symbolName);
        }
      }
      if (next.length === 0) break;
      frontier = next;
    }
    return Object.freeze(collected);
  }
}
