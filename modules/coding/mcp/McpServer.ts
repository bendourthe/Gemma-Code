import type { ToolMetadata } from "../../../src/tools/ToolCatalog.js";
import type { ToolRegistry } from "../../../src/tools/ToolRegistry.js";

/**
 * Default subset of tools exposed to external MCP clients. Read-only by
 * default so a hostile peer cannot use the MCP transport to drive write,
 * delete, or terminal operations without the user broadening the allowlist
 * via `gemma-code.mcpExposedTools`.
 */
export const DEFAULT_MCP_EXPOSED_TOOLS: readonly string[] = [
  "read_file",
  "list_directory",
  "grep_codebase",
];

/**
 * Exposes Gemma Code's built-in tools as an MCP server via stdio transport.
 * External MCP clients can connect and use the allowlisted tools remotely.
 *
 * The MCP SDK is loaded via dynamic import to avoid ESM/CJS interop issues.
 */
export class McpServer {
  private _server: { close(): Promise<void> } | null = null;
  private _running = false;

  constructor(
    private readonly _registry: ToolRegistry,
    private readonly _catalog: readonly ToolMetadata[],
    private readonly _exposedTools: readonly string[] = DEFAULT_MCP_EXPOSED_TOOLS,
  ) {}

  get isRunning(): boolean {
    return this._running;
  }

  async start(): Promise<void> {
    if (this._running) return;

    const { McpServer: SdkServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
    const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");

    const server = new SdkServer(
      { name: "gemma-code", version: "0.2.0" },
      { capabilities: { tools: {} } },
    );

    const registry = this._registry;
    const allowed = new Set(this._exposedTools);

    // Register only allowlisted tools. Pen-test F-004 hardening: an MCP peer
    // cannot drive write/delete/terminal tools by default.
    for (const tool of this._catalog) {
      const toolName = tool.name;

      if (!allowed.has(toolName)) continue;

      server.tool(
        toolName,
        tool.description,
        async (params: { [key: string]: unknown }) => {
          const result = await registry.execute({
            tool: toolName,
            id: `mcp-${Date.now()}`,
            parameters: params,
            source: "mcp",
          });

          return {
            content: [
              {
                type: "text" as const,
                text: result.success ? result.output : (result.error ?? "Tool execution failed."),
              },
            ],
            isError: !result.success,
          };
        },
      );
    }

    const transport = new StdioServerTransport();
    await server.connect(transport);
    this._server = server as { close(): Promise<void> };
    this._running = true;
  }

  async stop(): Promise<void> {
    if (!this._running || !this._server) return;
    try {
      await this._server.close();
    } catch {
      // Ignore close errors.
    }
    this._server = null;
    this._running = false;
  }
}
