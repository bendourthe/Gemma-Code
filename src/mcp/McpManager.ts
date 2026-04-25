import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as vscode from "vscode";
import { z } from "zod";
import type { DynamicToolMetadata, ToolParameterSchema } from "../tools/ToolCatalog.js";
import type { ToolRegistry } from "../tools/ToolRegistry.js";
import type { McpToolName } from "../tools/types.js";
import { McpClient } from "./McpClient.js";
import { McpToolHandler } from "./McpToolHandler.js";
import { getLogger } from "../utils/logger.js";
import { formatForLog } from "../utils/errors.js";
import type {
  McpServerConfig,
  McpServerState,
} from "./McpTypes.js";

const DEFAULT_MCP_PRIORITY = 100;

/** Env variable keys that are safe to inherit from the parent process. */
const ENV_WHITELIST_KEYS = new Set([
  "PATH",
  "HOME",
  "USERPROFILE",
  "APPDATA",
  "LANG",
  "LC_ALL",
  "TZ",
]);

/** Workspace-state key prefix for storing user approval of workspace-local mcp.json files. */
const WORKSPACE_APPROVAL_PREFIX = "mcp.workspaceConfigApproval:";

const McpServerConfigSchema = z.object({
  name: z
    .string()
    .min(1, "name is required")
    .max(64, "name must be 64 chars or fewer")
    .regex(/^[a-zA-Z0-9._-]+$/, "name must be alphanumeric with . _ -"),
  command: z.string().min(1, "command is required"),
  args: z.array(z.string()).optional(),
  transport: z.literal("stdio"),
  env: z
    .record(z.string(), z.string())
    .optional()
    .refine(
      (env) => !env || Object.keys(env).every((k) => /^[A-Z][A-Z0-9_]*$/.test(k)),
      { message: "env keys must be SHOUTING_SNAKE_CASE" },
    ),
});

const McpConfigFileSchema = z.object({
  servers: z.array(McpServerConfigSchema),
});

/**
 * Minimal VS Code workspaceState surface. Kept structural so tests can
 * supply a plain Map-backed implementation without pulling in the real API.
 */
export interface McpWorkspaceState {
  get(key: string): unknown;
  update(key: string, value: unknown): Thenable<void> | Promise<void>;
}

/**
 * Manages the lifecycle of MCP server connections, reads configuration,
 * and registers discovered MCP tools in the ToolRegistry.
 */
/**
 * Default workspace-local MCP confirmation via VS Code modal. Shown once per
 * workspace; subsequent activations reuse the stored approval.
 */
async function defaultWorkspaceConfirmation(
  configPath: string,
  servers: readonly McpServerConfig[],
): Promise<boolean> {
  const summary = servers
    .map((s) => `- ${s.name}: ${s.command}${s.args && s.args.length > 0 ? " " + s.args.join(" ") : ""}`)
    .join("\n");
  const answer = await vscode.window.showWarningMessage(
    `Gemma Code found a workspace-local MCP config at:\n\n${configPath}\n\n` +
      `Approving will let Gemma Code spawn the following processes whenever this workspace is open:\n\n${summary}\n\n` +
      `Only approve configs from repositories you trust.`,
    { modal: true },
    "Approve",
    "Decline",
  );
  return answer === "Approve";
}

export class McpManager {
  private readonly _clients = new Map<string, McpClient>();
  private _configs: McpServerConfig[] = [];

  constructor(
    private readonly _registry: ToolRegistry,
    private readonly _workspacePath?: string,
    private readonly _workspaceState?: McpWorkspaceState,
    private readonly _confirmWorkspaceConfig: (
      configPath: string,
      servers: readonly McpServerConfig[],
    ) => Promise<boolean> = defaultWorkspaceConfirmation,
  ) {}

  /** Load config and connect to all configured servers. */
  async initialize(): Promise<void> {
    this._configs = await this._loadConfigs();
    for (const config of this._configs) {
      await this.connectServer(config.name).catch((err) => {
        getLogger().warn(`[McpManager] Failed to connect to "${config.name}":`, err);
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
   *
   * Workspace-local configs require user approval (stored per-workspace) before
   * any server is spawned, so opening a hostile repository cannot silently
   * launch MCP binaries.
   */
  private async _loadConfigs(): Promise<McpServerConfig[]> {
    const byName = new Map<string, McpServerConfig>();

    // Global config: ~/.gemma-code/mcp.json (explicitly placed by user).
    const globalPath = path.join(os.homedir(), ".gemma-code", "mcp.json");
    for (const config of this._readConfigFile(globalPath)) {
      byName.set(config.name, this._sanitizeEnv(config));
    }

    // Workspace config: requires user approval keyed by workspace path.
    if (this._workspacePath) {
      const localPath = path.join(this._workspacePath, ".gemma-code", "mcp.json");
      const localConfigs = this._readConfigFile(localPath);
      if (localConfigs.length > 0) {
        const approved = await this._ensureWorkspaceApproval(localPath, localConfigs);
        if (approved) {
          for (const config of localConfigs) {
            byName.set(config.name, this._sanitizeEnv(config));
          }
        }
      }
    }

    return [...byName.values()];
  }

  private _readConfigFile(filePath: string): McpServerConfig[] {
    try {
      if (!fs.existsSync(filePath)) return [];
      const raw = fs.readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(raw) as unknown;
      const result = McpConfigFileSchema.safeParse(parsed);
      if (!result.success) {
        getLogger().warn(
          `[McpManager] Invalid MCP config at ${filePath}: ${result.error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; ")}`,
        );
        return [];
      }
      return result.data.servers.map((s) => ({ ...s, args: s.args ?? [] }));
    } catch (err) {
      getLogger().warn(
        `[McpManager] Failed to read MCP config at ${filePath}: ${formatForLog(err)}`,
      );
      return [];
    }
  }

  /**
   * Filter out any env entries whose keys are not in the whitelist.
   * Arbitrary env keys may be granted by future changes, but the safe-default
   * list excludes shell-override keys (LD_PRELOAD, PYTHONPATH, etc.).
   */
  private _sanitizeEnv(config: McpServerConfig): McpServerConfig {
    if (!config.env) return config;
    const filtered: Record<string, string> = {};
    for (const [k, v] of Object.entries(config.env)) {
      if (ENV_WHITELIST_KEYS.has(k)) {
        filtered[k] = v;
      } else {
        getLogger().warn(
          `[McpManager] Dropped non-whitelisted env key "${k}" for server "${config.name}"`,
        );
      }
    }
    return { ...config, env: filtered };
  }

  private async _ensureWorkspaceApproval(
    configPath: string,
    servers: readonly McpServerConfig[],
  ): Promise<boolean> {
    if (!this._workspaceState) return false; // No state => cannot remember; refuse for safety.

    const key = WORKSPACE_APPROVAL_PREFIX + configPath;
    const prior = this._workspaceState.get(key);
    if (prior === true) return true;

    const approved = await this._confirmWorkspaceConfig(configPath, servers);
    if (approved) {
      await this._workspaceState.update(key, true);
    }
    return approved;
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
