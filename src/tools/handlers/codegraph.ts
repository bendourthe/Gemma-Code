/**
 * v1.2.0 Phase 3.5 -- Coding-pillar adapters for the 8 `codegraph_*` tools.
 *
 * Each handler is a thin wrapper that delegates the tool call into a
 * shared `CodeGraphMcpServer` instance via the `McpHarnessAdapter`
 * contract. The handlers are intentionally identical except for the
 * `_toolName` they bind to; the implementation lives in
 * `core/codegraph/mcp/CodeGraphMcpServer.ts`.
 */

import type { McpHarnessAdapter } from "../../../core/coding/McpBridge.js";
import type { ToolHandler, ToolResult } from "../types.js";

export interface CodeGraphHandlerDeps {
  /**
   * Lazily-resolved MCP harness adapter. The factory is called on first
   * invocation and the resolved adapter is cached; subsequent calls reuse
   * it without re-instantiating the SQLite store.
   */
  readonly resolveServer: () => Promise<McpHarnessAdapter> | McpHarnessAdapter;
}

class CodeGraphToolHandler implements ToolHandler {
  private _server: McpHarnessAdapter | null = null;

  constructor(
    private readonly _toolName: string,
    private readonly _deps: CodeGraphHandlerDeps,
  ) {}

  async execute(parameters: Record<string, unknown>): Promise<ToolResult> {
    try {
      if (!this._server) {
        this._server = await Promise.resolve(this._deps.resolveServer());
      }
      const r = await this._server.invokeTool(this._toolName, parameters);
      return {
        id: `codegraph-${Date.now()}`,
        success: r.ok,
        output: r.result ?? "",
        error: r.error,
      };
    } catch (err) {
      return {
        id: `codegraph-${Date.now()}`,
        success: false,
        output: "",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

export class CodeGraphSearchTool extends CodeGraphToolHandler {
  constructor(deps: CodeGraphHandlerDeps) {
    super("codegraph_search", deps);
  }
}
export class CodeGraphContextTool extends CodeGraphToolHandler {
  constructor(deps: CodeGraphHandlerDeps) {
    super("codegraph_context", deps);
  }
}
export class CodeGraphTraceTool extends CodeGraphToolHandler {
  constructor(deps: CodeGraphHandlerDeps) {
    super("codegraph_trace", deps);
  }
}
export class CodeGraphCallersTool extends CodeGraphToolHandler {
  constructor(deps: CodeGraphHandlerDeps) {
    super("codegraph_callers", deps);
  }
}
export class CodeGraphCalleesTool extends CodeGraphToolHandler {
  constructor(deps: CodeGraphHandlerDeps) {
    super("codegraph_callees", deps);
  }
}
export class CodeGraphImpactTool extends CodeGraphToolHandler {
  constructor(deps: CodeGraphHandlerDeps) {
    super("codegraph_impact", deps);
  }
}
export class CodeGraphNodeTool extends CodeGraphToolHandler {
  constructor(deps: CodeGraphHandlerDeps) {
    super("codegraph_node", deps);
  }
}
export class CodeGraphExploreTool extends CodeGraphToolHandler {
  constructor(deps: CodeGraphHandlerDeps) {
    super("codegraph_explore", deps);
  }
}
export class CodeGraphFilesTool extends CodeGraphToolHandler {
  constructor(deps: CodeGraphHandlerDeps) {
    super("codegraph_files", deps);
  }
}

export const CODEGRAPH_TOOL_NAMES_FOR_REGISTRY = [
  "codegraph_search",
  "codegraph_context",
  "codegraph_trace",
  "codegraph_callers",
  "codegraph_callees",
  "codegraph_impact",
  "codegraph_node",
  "codegraph_explore",
  "codegraph_files",
] as const;
