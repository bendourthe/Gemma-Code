/**
 * v1.18.0 Phase 3 (OW-A5) -- in-memory MCP registry client for Settings tests.
 */

import type { McpRegistryClient, McpRegistryServerDto } from "./mcpTypes";

export function createMockMcpRegistryClient(
  initial: readonly McpRegistryServerDto[] = [],
): McpRegistryClient {
  let servers: McpRegistryServerDto[] = initial.map((s) => ({
    ...s,
    tools: s.tools.map((t) => ({ ...t })),
  }));

  return {
    async list() {
      return servers;
    },
    async setToolDenied(serverName, toolName, denied) {
      const server = servers.find((s) => s.name === serverName);
      if (!server || server.policyVerdict === "drop") {
        return {
          ok: false,
          reason: "policy-denied server: a toggle cannot enable or surface its tools",
          servers,
        };
      }
      servers = servers.map((s) => {
        if (s.name !== serverName) return s;
        const existing = s.tools.find((t) => t.name === toolName);
        const tools = existing
          ? s.tools.map((t) =>
              t.name === toolName
                ? {
                    ...t,
                    exposed: !denied,
                    reason: denied ? ("user-denied" as const) : ("allowed" as const),
                  }
                : t,
            )
          : [
              ...s.tools,
              {
                name: toolName,
                exposed: !denied,
                reason: denied ? ("user-denied" as const) : ("allowed" as const),
                toggleable: true,
              },
            ];
        return { ...s, tools };
      });
      return { ok: true, reason: denied ? "denied" : "undenied", servers };
    },
  };
}
