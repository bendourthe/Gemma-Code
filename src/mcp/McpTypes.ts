import type { McpToolName } from "../tools/types.js";

/** Configuration for a single MCP server, typically read from mcp.json. */
export interface McpServerConfig {
  readonly name: string;
  readonly command: string;
  readonly args?: readonly string[];
  readonly transport: "stdio";
  readonly env?: Record<string, string>;
}

/** Top-level structure of ~/.gemma-code/mcp.json or .gemma-code/mcp.json. */
export interface McpConfigFile {
  readonly servers: readonly McpServerConfig[];
}

/** A tool discovered from an external MCP server. */
export interface McpToolInfo {
  readonly serverName: string;
  /** Raw tool name as reported by the MCP server. */
  readonly name: string;
  /** Namespaced name for use in the Gemma Code tool system: `mcp:serverName/toolName`. */
  readonly qualifiedName: McpToolName;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}

export type McpConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

/** Runtime state of a single MCP server connection. */
export interface McpServerState {
  readonly config: McpServerConfig;
  readonly status: McpConnectionStatus;
  readonly tools: readonly McpToolInfo[];
  readonly error?: string;
}
