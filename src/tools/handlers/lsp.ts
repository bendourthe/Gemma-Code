/**
 * v1.2.0 Phase 6.2 -- Coding-pillar adapters for the 2 `lsp_*` tools.
 *
 * Mirrors the codegraph handler pattern from `src/tools/handlers/codegraph.ts`
 * so the daemon's tool registry can route `lsp_definition` and
 * `lsp_references` through the same `McpHarnessAdapter` plumbing.
 *
 * The harness adapter is constructed lazily so we do not spawn an LSP
 * server (or pay the import cost of `core/coding/lsp/`) at startup --
 * the per-language child process only launches on the first request.
 */

import type { McpHarnessAdapter } from "../../../core/coding/McpBridge.js";
import type { ToolHandler, ToolResult } from "../types.js";

export interface LspHandlerDeps {
  readonly resolveServer: () => Promise<McpHarnessAdapter> | McpHarnessAdapter;
}

class LspToolHandler implements ToolHandler {
  private _server: McpHarnessAdapter | null = null;

  constructor(
    private readonly _toolName: string,
    private readonly _deps: LspHandlerDeps,
  ) {}

  async execute(parameters: Record<string, unknown>): Promise<ToolResult> {
    try {
      if (!this._server) {
        this._server = await Promise.resolve(this._deps.resolveServer());
      }
      const r = await this._server.invokeTool(this._toolName, parameters);
      return {
        id: `lsp-${Date.now()}`,
        success: r.ok,
        output: r.result ?? "",
        error: r.error,
      };
    } catch (err) {
      return {
        id: `lsp-${Date.now()}`,
        success: false,
        output: "",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

export class LspDefinitionTool extends LspToolHandler {
  constructor(deps: LspHandlerDeps) {
    super("lsp_definition", deps);
  }
}

export class LspReferencesTool extends LspToolHandler {
  constructor(deps: LspHandlerDeps) {
    super("lsp_references", deps);
  }
}

export const LSP_TOOL_NAMES_FOR_REGISTRY = [
  "lsp_definition",
  "lsp_references",
] as const;
