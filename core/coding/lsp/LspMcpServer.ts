/**
 * v1.2.0 Phase 6.2 -- MCP adapter exposing `lsp_definition` and
 * `lsp_references` over the existing daemon MCP harness.
 *
 * Wraps `LspClient` in the `McpHarnessAdapter` contract from
 * `core/coding/McpBridge.ts` so the daemon registers it next to
 * `CodeGraphMcpServer` and external stdio MCP servers.
 *
 * The two tools are intentionally narrow:
 *   - `lsp_definition({ language, filePath, line, column, fileContents })`
 *   - `lsp_references({ language, filePath, line, column, fileContents,
 *      includeDeclaration? })`
 *
 * `fileContents` is required because the LSP servers expect a
 * `textDocument/didOpen` before the first request against a path. The
 * Coding-pillar agent loop already reads the file before asking for
 * references, so threading the content through the tool call is the
 * simplest path that does not require the LSP server to re-read from
 * disk.
 */

import type {
  McpHarnessAdapter,
  McpInvokeResult,
  McpToolDescriptor,
} from "../McpBridge.js";
import {
  LspClient,
  type LspClientOptions,
  type LspLanguage,
} from "./LspClient.js";

export const LSP_MCP_SERVER_ID = "nexus.lsp" as const;

export const LSP_TOOL_NAMES = [
  "lsp_definition",
  "lsp_references",
] as const;
export type LspToolName = (typeof LSP_TOOL_NAMES)[number];

const TOOL_DESCRIPTIONS: Record<LspToolName, string> = {
  lsp_definition:
    "Resolve the definition of the symbol at (line, column) in the given file via an LSP server. Returns LSP `Location[]`. Args: { language: 'typescript'|'python'|'rust', filePath: string, line: number, column: number, fileContents: string }.",
  lsp_references:
    "List symbol references (text-aware, not text matches) for the symbol at (line, column). Args: { language, filePath, line, column, fileContents, includeDeclaration?: boolean }.",
};

const COMMON_PROPS = {
  language: {
    type: "string",
    enum: ["typescript", "python", "rust"],
    description: "Language of the source file.",
  },
  filePath: { type: "string", description: "Absolute path on disk." },
  line: { type: "number", description: "Zero-based line index." },
  column: { type: "number", description: "Zero-based column index." },
  fileContents: {
    type: "string",
    description: "Current contents of the file (used for LSP didOpen).",
  },
};

const TOOL_INPUT_SCHEMAS: Record<LspToolName, string> = {
  lsp_definition: JSON.stringify({
    type: "object",
    properties: COMMON_PROPS,
    required: ["language", "filePath", "line", "column", "fileContents"],
    additionalProperties: false,
  }),
  lsp_references: JSON.stringify({
    type: "object",
    properties: {
      ...COMMON_PROPS,
      includeDeclaration: { type: "boolean" },
    },
    required: ["language", "filePath", "line", "column", "fileContents"],
    additionalProperties: false,
  }),
};

export interface LspMcpServerOptions extends LspClientOptions {
  /** Override the underlying client (tests inject in-memory fakes). */
  readonly client?: LspClient;
}

export class LspMcpServer implements McpHarnessAdapter {
  private readonly _client: LspClient;

  constructor(opts: LspMcpServerOptions = {}) {
    this._client = opts.client ?? new LspClient(opts);
  }

  listTools(): readonly McpToolDescriptor[] {
    return Object.freeze(
      LSP_TOOL_NAMES.map((name) =>
        Object.freeze({
          name,
          description: TOOL_DESCRIPTIONS[name],
          inputSchema: TOOL_INPUT_SCHEMAS[name],
          serverId: LSP_MCP_SERVER_ID,
        }),
      ),
    );
  }

  async invokeTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<McpInvokeResult> {
    if (!LSP_TOOL_NAMES.includes(name as LspToolName)) {
      return { ok: false, toolName: name, error: `Unknown LSP tool: ${name}` };
    }
    try {
      const result =
        name === "lsp_definition"
          ? await this._client.definition(this._parseDefinitionArgs(args))
          : await this._client.references(this._parseReferencesArgs(args));
      return {
        ok: result.ok,
        toolName: name,
        result: JSON.stringify(result),
        error: result.error,
      };
    } catch (err) {
      return {
        ok: false,
        toolName: name,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /** Shut down the underlying LSP client (and every managed child). */
  async shutdown(): Promise<void> {
    await this._client.shutdown();
  }

  /** Test helper: whether a given LSP server is available. */
  isServerAvailable(language: LspLanguage): boolean {
    return this._client.isServerAvailable(language);
  }

  private _parseDefinitionArgs(args: Record<string, unknown>) {
    return {
      language: this._language(args),
      filePath: this._string(args, "filePath"),
      line: this._number(args, "line"),
      column: this._number(args, "column"),
      // Empty `fileContents` is valid (e.g. a brand-new empty file the
      // LSP still wants to didOpen on); only the type matters here.
      fileContents: this._stringAllowEmpty(args, "fileContents"),
    };
  }

  private _stringAllowEmpty(args: Record<string, unknown>, key: string): string {
    const v = args[key];
    if (typeof v !== "string") {
      throw new Error(`Missing string argument: ${key}`);
    }
    return v;
  }

  private _parseReferencesArgs(args: Record<string, unknown>) {
    return {
      ...this._parseDefinitionArgs(args),
      includeDeclaration:
        typeof args["includeDeclaration"] === "boolean"
          ? (args["includeDeclaration"] as boolean)
          : undefined,
    };
  }

  private _language(args: Record<string, unknown>): LspLanguage {
    const v = args["language"];
    if (v === "typescript" || v === "python" || v === "rust") return v;
    throw new Error(`Unsupported or missing language: ${String(v)}`);
  }

  private _string(args: Record<string, unknown>, key: string): string {
    const v = args[key];
    if (typeof v !== "string" || v.length === 0) {
      throw new Error(`Missing string argument: ${key}`);
    }
    return v;
  }

  private _number(args: Record<string, unknown>, key: string): number {
    const v = args[key];
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
      throw new Error(`Missing or invalid numeric argument: ${key}`);
    }
    return v;
  }
}
