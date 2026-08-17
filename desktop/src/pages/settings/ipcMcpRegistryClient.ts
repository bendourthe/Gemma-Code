/**
 * v1.18.0 Phase 3 (OW-A5) -- production MCP registry client over sidecar IPC.
 */

import { ipcCall } from "../../lib/ipc";
import type { McpRegistryClient, McpRegistryServerDto } from "./mcpTypes";

export function createIpcMcpRegistryClient(): McpRegistryClient {
  return {
    async list(): Promise<readonly McpRegistryServerDto[]> {
      const reply = await ipcCall<{ servers: McpRegistryServerDto[] }>("mcp.registry.list", {});
      if (!reply.ok) throw new Error(reply.message);
      return reply.value.servers;
    },
    async setToolDenied(serverName, toolName, denied) {
      const reply = await ipcCall<{
        ok: boolean;
        reason: string;
        servers: McpRegistryServerDto[];
      }>("mcp.registry.setToolDenied", { serverName, toolName, denied });
      if (!reply.ok) throw new Error(reply.message);
      return reply.value;
    },
  };
}
