import type { ToolMetadata } from "../tools/ToolCatalog.js";
import type { ToolRegistry } from "../tools/ToolRegistry.js";

/**
 * Exposes Gemma Code's built-in tools as an MCP server via stdio transport.
 * External MCP clients can connect and use Gemma Code's tools remotely.
 *
 * The MCP SDK is loaded via dynamic import to avoid ESM/CJS interop issues.
 */
export class McpServer {
  private _server: { close(): Promise<void> } | null = null;
  private _running = false;

  constructor(
    private readonly _registry: ToolRegistry,
    private readonly _catalog: readonly ToolMetadata[],
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

    // Register each built-in tool as an MCP tool using the simple (name, description, cb) overload.
    for (const tool of this._catalog) {
      const toolName = tool.name;

      server.tool(
        toolName,
        tool.description,
        async (params: { [key: string]: unknown }) => {
          const result = await registry.execute({
            tool: toolName,
            id: `mcp-${Date.now()}`,
            parameters: params,
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
