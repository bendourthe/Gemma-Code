/**
 * v1.1.0 Phase 11.7 -- daemon-side MCP bridge.
 *
 * MCP tools registered with the daemon's MCP harness are usable from the
 * extension via a pair of IPC methods: `mcp.list` returns the catalog of
 * tools known to the harness; `mcp.invoke` runs one tool against a given
 * argument blob and returns the structured result.
 *
 * Both methods are pure delegators; this module ships the contract and an
 * in-process harness adapter used by integration tests + the parity
 * snapshot. The cross-process transport lives behind the `IpcClient`
 * interface defined under [src/desktop/ipcClient.ts](../../src/desktop/ipcClient.ts).
 */

export interface McpToolDescriptor {
  readonly name: string;
  readonly description: string;
  readonly /** JSON-encoded schema string; the extension only renders it. */ inputSchema: string;
  readonly serverId: string;
}

export interface McpHarnessAdapter {
  listTools(): readonly McpToolDescriptor[] | Promise<readonly McpToolDescriptor[]>;
  invokeTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<McpInvokeResult>;
}

export interface McpInvokeResult {
  readonly ok: boolean;
  readonly toolName: string;
  readonly result?: string;
  readonly error?: string;
}

export interface McpListResponse {
  readonly tools: readonly McpToolDescriptor[];
}

export interface McpInvokeRequest {
  readonly name: string;
  readonly args: Record<string, unknown>;
}

export interface McpInvokeResponse {
  readonly ok: boolean;
  readonly toolName: string;
  readonly result: string | null;
  readonly error: string | null;
}

export const MCP_LIST_METHOD = "mcp.list";
export const MCP_INVOKE_METHOD = "mcp.invoke";

/**
 * Build the daemon-side `mcp.list` handler bound to a given harness adapter.
 * Returns a function the IPC router can register directly.
 */
export function buildMcpListHandler(
  harness: Pick<McpHarnessAdapter, "listTools">,
): () => Promise<McpListResponse> {
  return async () => {
    const tools = await Promise.resolve(harness.listTools());
    return Object.freeze({ tools: Object.freeze([...tools]) });
  };
}

/**
 * Build the daemon-side `mcp.invoke` handler bound to a given harness
 * adapter. Returns a function the IPC router can register directly.
 *
 * The function tolerates handler throws -- it converts every thrown
 * value into a structured `{ ok: false, error }` shape so the extension
 * UI never sees a transport-level rejection from a tool-level failure.
 */
export function buildMcpInvokeHandler(
  harness: McpHarnessAdapter,
): (request: McpInvokeRequest) => Promise<McpInvokeResponse> {
  return async (request) => {
    if (!request || typeof request.name !== "string" || request.name.length === 0) {
      return Object.freeze({
        ok: false,
        toolName: "",
        result: null,
        error: "mcp.invoke: missing or empty tool name.",
      });
    }
    try {
      const r = await harness.invokeTool(request.name, request.args ?? {});
      return Object.freeze({
        ok: r.ok,
        toolName: r.toolName,
        result: r.result ?? null,
        error: r.error ?? null,
      });
    } catch (err) {
      return Object.freeze({
        ok: false,
        toolName: request.name,
        result: null,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };
}

/**
 * Convenience: build both handlers at once. Use when wiring a sidecar.
 */
export function buildMcpHandlers(harness: McpHarnessAdapter): {
  readonly list: ReturnType<typeof buildMcpListHandler>;
  readonly invoke: ReturnType<typeof buildMcpInvokeHandler>;
} {
  return Object.freeze({
    list: buildMcpListHandler(harness),
    invoke: buildMcpInvokeHandler(harness),
  });
}
