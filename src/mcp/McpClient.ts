import type { ToolResult } from "../tools/types.js";
import type { McpToolName } from "../tools/types.js";
import type {
  McpConnectionStatus,
  McpServerConfig,
  McpToolInfo,
} from "./McpTypes.js";
import { stripHtmlTags } from "../tools/handlers/webSearch.js";
import { getLogger } from "../utils/logger.js";
import { formatForUser } from "../utils/errors.js";

/**
 * Environment variables that are safely propagated to spawned MCP subprocesses.
 * Additional keys may be allowed by listing them in the server's `env` config.
 */
const DEFAULT_ENV_WHITELIST = ["PATH", "HOME", "USERPROFILE", "APPDATA"] as const;

/** Maximum length of an MCP tool description (characters) after sanitization. */
const MAX_TOOL_DESCRIPTION_CHARS = 500;

/** Pattern every MCP tool name must match to be accepted. */
const TOOL_NAME_REGEX = /^[a-zA-Z0-9_]{1,64}$/;

function sanitizeToolDescription(raw: string | undefined): string {
  if (!raw) return "";
  const stripped = stripHtmlTags(raw);
  return stripped.length <= MAX_TOOL_DESCRIPTION_CHARS
    ? stripped
    : stripped.slice(0, MAX_TOOL_DESCRIPTION_CHARS);
}

/**
 * Connects to a single external MCP server, discovers its tools,
 * and delegates tool calls via the MCP JSON-RPC protocol.
 *
 * The MCP SDK is loaded via dynamic import to avoid ESM/CJS interop issues.
 */
export class McpClient {
  private _client: { close(): Promise<void>; connect(transport: unknown): Promise<void>; listTools(): Promise<{ tools: Array<{ name: string; description?: string; inputSchema: Record<string, unknown> }> }>; callTool(params: { name: string; arguments: Record<string, unknown> }): Promise<{ content: Array<{ type: string; text?: string }>; isError?: boolean }> } | null = null;
  private _transport: unknown = null;
  private _status: McpConnectionStatus = "disconnected";
  private _error: string | undefined;
  private _tools: McpToolInfo[] = [];

  constructor(private readonly _config: McpServerConfig) {}

  get status(): McpConnectionStatus {
    return this._status;
  }

  get error(): string | undefined {
    return this._error;
  }

  get tools(): readonly McpToolInfo[] {
    return this._tools;
  }

  async connect(): Promise<void> {
    if (this._status === "connected" || this._status === "connecting") return;

    this._status = "connecting";
    this._error = undefined;

    try {
      const { Client } = await import("@modelcontextprotocol/sdk/client");
      const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");

      // Start with ONLY a minimal whitelist from process.env (no full inheritance).
      const envRecord: Record<string, string> = {};
      for (const key of DEFAULT_ENV_WHITELIST) {
        const v = process.env[key];
        if (typeof v === "string") envRecord[key] = v;
      }
      // Add explicitly-configured env keys.
      if (this._config.env) {
        for (const [k, v] of Object.entries(this._config.env)) {
          envRecord[k] = v;
        }
      }

      this._transport = new StdioClientTransport({
        command: this._config.command,
        args: this._config.args ? [...this._config.args] : undefined,
        env: envRecord,
      });

      const client = new Client(
        { name: "gemma-code", version: "0.2.0" },
        { capabilities: {} },
      );

      await client.connect(this._transport as never);

      // Discover tools from the server; skip any with an unsafe name.
      const { tools } = await client.listTools();
      this._tools = [];
      for (const t of tools) {
        if (!TOOL_NAME_REGEX.test(t.name)) {
          getLogger().warn(
            `[McpClient] Rejected tool name from server "${this._config.name}": "${t.name}"`,
          );
          continue;
        }
        this._tools.push({
          serverName: this._config.name,
          name: t.name,
          qualifiedName: `mcp:${this._config.name}/${t.name}` as McpToolName,
          description: sanitizeToolDescription(t.description),
          inputSchema: t.inputSchema as Record<string, unknown>,
        });
      }

      this._client = client as never;
      this._status = "connected";
    } catch (err) {
      this._status = "error";
      this._error = formatForUser(err);
      this._tools = [];
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    if (this._status === "disconnected") return;
    try {
      await this._client?.close();
    } catch {
      // Ignore close errors during disconnect.
    }
    this._client = null;
    this._transport = null;
    this._tools = [];
    this._status = "disconnected";
    this._error = undefined;
  }

  /**
   * Call a tool on the connected MCP server. The name should be the raw tool
   * name (without the `mcp:serverName/` prefix).
   */
  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<ToolResult> {
    if (!this._client || this._status !== "connected") {
      return {
        id: "",
        success: false,
        output: "",
        error: `MCP server "${this._config.name}" is not connected.`,
      };
    }

    try {
      const result = await this._client.callTool({ name, arguments: args });

      // Extract text content from the MCP response.
      const textParts = result.content
        .filter((c: { type: string; text?: string }) => c.type === "text" && c.text !== undefined)
        .map((c: { type: string; text?: string }) => c.text!);

      const output = textParts.join("\n");
      const isError = result.isError === true;

      return {
        id: "",
        success: !isError,
        output,
        ...(isError ? { error: output } : {}),
      };
    } catch (err) {
      return {
        id: "",
        success: false,
        output: "",
        error: formatForUser(err),
      };
    }
  }
}
