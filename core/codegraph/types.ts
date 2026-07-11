/**
 * v1.2.0 Phase 3.1 -- public types for the code-graph module.
 *
 * The code-graph indexes a repo into three persistent records (`Symbol`,
 * `CallEdge`, `FileNode`) backed by SQLite + FTS5. The Coding-pillar agent
 * loop consults the graph via the 8 `codegraph_*` MCP tools so it does not
 * have to spawn discovery sub-agents that scan files repeatedly.
 *
 * See `docs/v1/v1.2/plans/adoption-ecosystem-2026-05.md` Phase 3 for the
 * full design context and stability gate (<=30% of the tool calls the
 * reference task takes without the graph available).
 */

/** Supported source-file languages. */
export type CodeGraphLanguage = "typescript" | "python" | "rust" | "go";

/** Kind tag for a parsed symbol. */
export type SymbolKind =
  | "function"
  | "method"
  | "class"
  | "interface"
  | "type"
  | "struct"
  | "enum"
  | "trait"
  | "module";

/** Kind tag for a call-edge relationship. */
export type CallEdgeKind = "call" | "instantiation";

export interface FileNode {
  readonly id: number;
  readonly path: string;
  readonly language: CodeGraphLanguage;
  readonly lastIndexedAt: number;
  readonly contentHash: string;
}

export interface Symbol {
  readonly id: number;
  readonly fileId: number;
  readonly name: string;
  readonly kind: SymbolKind;
  readonly lineStart: number;
  readonly lineEnd: number;
  readonly signatureText: string;
}

export interface CallEdge {
  readonly callerSymbolId: number;
  readonly calleeSymbolId: number;
  readonly line: number;
  readonly kind: CallEdgeKind;
}

/** Query options shared across MCP tool entry points. */
export interface GraphQuery {
  readonly symbolName?: string;
  readonly ftsQuery?: string;
  readonly depth?: number;
}

/** Generic query result envelope returned by the MCP tools. */
export interface GraphResult<T = unknown> {
  readonly ok: boolean;
  readonly data: T;
  readonly error?: string;
}

/** Per-file scan outcome reported by the scanner. */
export interface ScannedFileSummary {
  readonly path: string;
  readonly language: CodeGraphLanguage;
  readonly skipped: boolean;
  readonly skipReason?: "unchanged" | "size-cap" | "ignored" | "unsupported";
  readonly symbolCount: number;
  readonly edgeCount: number;
}

/** Aggregate scan outcome for a whole-repo or incremental pass. */
export interface ScanReport {
  readonly filesVisited: number;
  readonly filesIndexed: number;
  readonly filesSkippedUnchanged: number;
  readonly filesSkippedIgnored: number;
  readonly filesSkippedSizeCap: number;
  readonly symbolsUpserted: number;
  readonly edgesUpserted: number;
  readonly elapsedMs: number;
}

/** Public input shape for `codegraph_search` (FTS lookup). */
export interface SymbolSearchHit {
  readonly id: number;
  readonly name: string;
  readonly kind: SymbolKind;
  readonly filePath: string;
  readonly lineStart: number;
  readonly lineEnd: number;
  readonly signaturePreview: string;
}

/** Caller / callee pair surfaced by `codegraph_callers` / `codegraph_callees`. */
export interface SymbolReference {
  readonly symbolId: number;
  readonly symbolName: string;
  readonly filePath: string;
  readonly lineStart: number;
  readonly lineEnd: number;
}

/** Trace edge surfaced by `codegraph_trace`. */
export interface TraceEdge {
  readonly fromSymbolId: number;
  readonly fromSymbolName: string;
  readonly toSymbolId: number;
  readonly toSymbolName: string;
  readonly line: number;
}

export interface TracePath {
  readonly edges: readonly TraceEdge[];
}

/** Context bundle returned by `codegraph_context` and `codegraph_node`. */
export interface SymbolContext {
  readonly symbol: SymbolSearchHit;
  readonly callers: readonly SymbolReference[];
  readonly callees: readonly SymbolReference[];
}

/** Aggregate returned by `codegraph_impact`. */
export interface ImpactReport {
  readonly symbol: SymbolSearchHit;
  readonly directCallers: readonly SymbolReference[];
  readonly transitiveCallers: readonly SymbolReference[];
  readonly impactRadius: number;
}

/** Exploration bundle returned by `codegraph_explore`. */
export interface ExploreReport {
  readonly contexts: readonly SymbolContext[];
}

/** Listing returned by `codegraph_files`. */
export interface FilesListing {
  readonly files: readonly FileNode[];
}
