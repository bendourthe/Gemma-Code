/**
 * v1.18.0 Phase 3 (OW-A5) -- Settings > MCP per-tool deny.
 *
 * Lists user-registered and Hub-catalog MCP servers. Per-tool checkboxes only
 * further restrict: a Hub policy-dropped server cannot be enabled from here.
 */

import { useCallback, useEffect, useState } from "react";

import { Button, Switch, TextField } from "../../components/ui";
import type { McpRegistryClient, McpRegistryServerDto } from "./mcpTypes";

export interface McpRegistrySettingsProps {
  client: McpRegistryClient;
}

export function McpRegistrySettings({ client }: McpRegistrySettingsProps): JSX.Element {
  const [servers, setServers] = useState<readonly McpRegistryServerDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [newDeny, setNewDeny] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    try {
      const list = await client.list();
      setServers(list);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [client]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const toggle = useCallback(
    async (serverName: string, toolName: string, deny: boolean) => {
      setPending(`${serverName}/${toolName}`);
      try {
        const result = await client.setToolDenied(serverName, toolName, deny);
        setServers(result.servers);
        if (!result.ok) setError(result.reason);
        else setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setPending(null);
      }
    },
    [client],
  );

  return (
    <section data-testid="mcp-registry-settings" style={{ padding: "var(--space-4, 16px)" }}>
      <h2 style={{ margin: "0 0 var(--space-2, 8px)", fontSize: "var(--text-md, 1rem)" }}>MCP tools</h2>
      <p style={{ color: "var(--fg-muted)", marginTop: 0 }}>
        Disable individual tools per server. Toggles only tighten the default-deny: a
        Hub policy-blocked server cannot be enabled from here.
      </p>
      {error ? (
        <p data-testid="mcp-registry-error" role="alert" style={{ color: "var(--accent-danger, #f55)" }}>
          {error}
        </p>
      ) : null}
      {servers.length === 0 ? (
        <p data-testid="mcp-registry-empty" style={{ color: "var(--fg-muted)" }}>
          No MCP servers registered for this project.
        </p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {servers.map((server) => (
            <li
              key={server.name}
              data-testid={`mcp-server-${server.name}`}
              style={{
                border: "1px solid var(--border-1)",
                borderRadius: "var(--radius-md)",
                padding: "var(--space-3, 12px)",
                marginBottom: "var(--space-3, 12px)",
              }}
            >
              <header style={{ display: "flex", gap: "var(--space-2, 8px)", alignItems: "baseline" }}>
                <strong>{server.name}</strong>
                <span style={{ color: "var(--fg-muted)", fontSize: "var(--text-xs, 0.75rem)" }}>
                  {server.source} · {server.policyVerdict}
                </span>
              </header>
              <p style={{ color: "var(--fg-muted)", fontSize: "var(--text-xs, 0.75rem)" }}>
                {server.policyReason}
              </p>
              {server.policyVerdict === "drop" ? (
                <p data-testid={`mcp-server-${server.name}-locked`}>
                  Blocked by the MCP Registry Policy. Per-tool toggles cannot enable it.
                </p>
              ) : null}
              {server.tools.map((tool) => (
                <Switch
                  key={tool.name}
                  testId={`mcp-tool-${server.name}-${tool.name}`}
                  checked={tool.exposed}
                  disabled={!tool.toggleable || pending === `${server.name}/${tool.name}`}
                  onChange={(checked) => {
                    void toggle(server.name, tool.name, !checked);
                  }}
                  label={
                    <>
                      <span>{tool.name}</span>
                      <span style={{ color: "var(--fg-muted)", fontSize: "var(--text-xs, 0.75rem)", marginLeft: "var(--space-2)" }}>
                        {tool.reason}
                      </span>
                    </>
                  }
                />
              ))}
              {server.policyVerdict === "allow" ? (
                <form
                  style={{ display: "flex", gap: "var(--space-2, 8px)", marginTop: "var(--space-2, 8px)" }}
                  onSubmit={(e) => {
                    e.preventDefault();
                    const name = (newDeny[server.name] ?? "").trim();
                    if (!name) return;
                    void toggle(server.name, name, true);
                    setNewDeny((prev) => ({ ...prev, [server.name]: "" }));
                  }}
                >
                  <TextField
                    testId={`mcp-deny-input-${server.name}`}
                    value={newDeny[server.name] ?? ""}
                    onChange={(value) =>
                      setNewDeny((prev) => ({ ...prev, [server.name]: value }))
                    }
                    placeholder="Tool name to disable"
                    style={{ flex: 1 }}
                  />
                  <Button type="submit" testId={`mcp-deny-add-${server.name}`}>
                    Disable
                  </Button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
