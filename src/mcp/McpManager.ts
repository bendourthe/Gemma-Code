import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { DynamicToolMetadata, ToolParameterSchema } from "../tools/ToolCatalog.js";
import type { ToolRegistry } from "../tools/ToolRegistry.js";
import type { McpToolName } from "../tools/types.js";
import { McpClient } from "./McpClient.js";
import { McpToolHandler } from "./McpToolHandler.js";
import type {
  McpConfigFile,
  McpServerConfig,
  McpServerState,
} from "./McpTypes.js";

const DEFAULT_MCP_PRIORITY = 100;

/**
 * Manages the lifecycle of MCP server connections, reads configuration,
 * and registers discovered MCP tools in the ToolRegistry.
 */
export class McpManager {
  private readonly _clients = new Map<string, McpClient>();
  private _configs: McpServerConfig[] = [];

  constructor(
    private readonly _registry: ToolRegistry,
    private readonly _workspacePath?: string,
  ) {}

  /** Load config and connect to all configured servers. */
  async initialize(): Promise<void> {
    this._configs = this._loadConfigs();
    for (const config of this._configs) {
      await this.connectServer(config.name).catch((err) => {
        console.warn(`[McpManager] Failed to connect to "${config.name}":`, err);
      });
    }
  }

  /** Connect (or reconnect) a named server from the loaded configs. */
  async connectServer(name: string): Promise<void> {
    // Disconnect first if already connected.
    const existing = this._clients.get(name);
    if (existing) {
      await this._disconnectClient(name, existing);
    }

    const config = this._configs.find((c) => c.name === name);
    if (!config) {
      throw new Error(`No MCP server configured with name "${name}".`);
    }

    const client = new McpClient(config);
    this._clients.set(name, client);

    await client.connect();

    // Register each discovered tool in the ToolRegistry.
    for (const tool of client.tools) {
      this._registry.register(
        tool.qualifiedName,
        new McpToolHandler(client, tool.name),
      );
    }
  }

  async disconnectServer(name: string): Promise<void> {
    const client = this._clients.get(name);
    if (!client) return;
    await this._disconnectClient(name, client);
  }

  getServerStates(): McpServerState[] {
    return this._configs.map((config) => {
      const client = this._clients.get(config.name);
      return {
        config,
        status: client?.status ?? "disconnected",
        tools: client?.tools ?? [],
        error: client?.error,
      };
    });
  }

  /** Return all MCP tools as DynamicToolMetadata for PromptContext injection. */
  getAllToolMetadata(): DynamicToolMetadata[] {
    const result: DynamicToolMetadata[] = [];
    for (const client of this._clients.values()) {
      if (client.status !== "connected") continue;
      for (const tool of client.tools) {
        result.push(this._toToolMetadata(tool.qualifiedName, tool.description, tool.inputSchema));
      }
    }
    return result;
  }

  dispose(): void {
    for (const [name, client] of this._clients) {
      void client.disconnect().catch(() => {});
      this._clients.delete(name);
    }
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private async _disconnectClient(name: string, client: McpClient): Promise<void> {
    // Unregister the tools from the registry before disconnecting.
    for (const tool of client.tools) {
      this._registry.setEnabled(tool.qualifiedName, false);
    }
    await client.disconnect();
    this._clients.delete(name);
  }

  /**
   * Load MCP config from workspace-local and global locations.
   * Workspace config overrides global config for same-named servers.
   */
  private _loadConfigs(): McpServerConfig[] {
    const byName = new Map<string, McpServerConfig>();

    // Global config: ~/.gemma-code/mcp.json
    const globalPath = path.join(os.homedir(), ".gemma-code", "mcp.json");
    for (const config of this._readConfigFile(globalPath)) {
      byName.set(config.name, config);
    }

    // Workspace config overrides global for same-named servers.
    if (this._workspacePath) {
      const localPath = path.join(this._workspacePath, ".gemma-code", "mcp.json");
      for (const config of this._readConfigFile(localPath)) {
        byName.set(config.name, config);
      }
    }

    return [...byName.values()];
  }

  private _readConfigFile(filePath: string): McpServerConfig[] {
    try {
      if (!fs.existsSync(filePath)) return [];
      const raw = fs.readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(raw) as McpConfigFile;
      if (!Array.isArray(parsed.servers)) return [];
      return parsed.servers.filter(
        (s): s is McpServerConfig =>
          typeof s.name === "string" &&
          typeof s.command === "string" &&
          s.transport === "stdio",
      );
    } catch {
      return [];
    }
  }

  private _toToolMetadata(
    qualifiedName: McpToolName,
    description: string,
    inputSchema: Record<string, unknown>,
  ): DynamicToolMetadata {
    const params: Record<string, ToolParameterSchema> = {};
    const props = (inputSchema.properties ?? {}) as Record<string, { type?: string; description?: string }>;
    const required = new Set(
      Array.isArray(inputSchema.required) ? (inputSchema.required as string[]) : [],
    );

    for (const [key, prop] of Object.entries(props)) {
      params[key] = {
        type: prop.type ?? "string",
        description: prop.description ?? "",
        required: required.has(key),
      };
    }

    return {
      name: qualifiedName,
      description,
      parameters: params,
      source: "mcp",
      priority: DEFAULT_MCP_PRIORITY,
    };
  }
}
