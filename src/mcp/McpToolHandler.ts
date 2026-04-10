import type { ToolHandler, ToolResult } from "../tools/types.js";
import type { McpClient } from "./McpClient.js";

/**
 * A ToolHandler that delegates execution to an MCP server via McpClient.
 * Each instance wraps a single MCP tool on a single server.
 */
export class McpToolHandler implements ToolHandler {
  constructor(
    private readonly _client: McpClient,
    private readonly _mcpToolName: string,
  ) {}

  async execute(parameters: Record<string, unknown>): Promise<ToolResult> {
    return this._client.callTool(this._mcpToolName, parameters);
  }
}
