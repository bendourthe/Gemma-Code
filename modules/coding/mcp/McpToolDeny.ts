/**
 * v1.18.0 Phase 3 (OW-A5) -- per-tool MCP allow/deny that only ever tightens
 * the Hub Registry Policy default-deny.
 *
 * Layered ON TOP of `HubRegistryPolicyFilter`: a dropped server exposes no
 * tools, and a user toggle cannot enable a tool the policy classified as
 * denied. User denials subtract from the discovered (or known) tool set of a
 * policy-allowed server. Persisted per-project as `.nexus/mcp-tool-deny.json`.
 *
 * Boundary: vscode-free; pure (no filesystem). Callers read/write the file.
 */

export const MCP_TOOL_DENY_VERSION = 1 as const;
export const MCP_TOOL_DENY_FILENAME = "mcp-tool-deny.json";

export type McpPolicyVerdict = "allow" | "drop";

export type McpToolExposureReason = "allowed" | "user-denied" | "policy-denied";

export interface McpServerToolDeny {
  readonly deniedTools: readonly string[];
  /** Last-seen discovered names so the settings UI can render toggles offline. */
  readonly knownTools?: readonly string[];
}

export interface McpToolDenyFile {
  readonly version: typeof MCP_TOOL_DENY_VERSION;
  readonly servers: Readonly<Record<string, McpServerToolDeny>>;
}

export interface McpToolExposure {
  readonly serverName: string;
  readonly toolName: string;
  readonly exposed: boolean;
  readonly reason: McpToolExposureReason;
}

export interface ResolveExposedMcpToolsInput {
  readonly serverName: string;
  readonly policyVerdict: McpPolicyVerdict;
  readonly discoveredTools: readonly string[];
  readonly userDenied: readonly string[];
  /**
   * Adversarial / UI "enable" attempts. Tools named here that the policy
   * dropped, or that were never discovered, are recorded in `rejectedEnables`
   * and never appear in `exposed`.
   */
  readonly userRequestedEnable?: readonly string[];
}

export interface ResolveExposedMcpToolsResult {
  readonly exposed: readonly string[];
  readonly rejectedEnables: readonly string[];
  readonly tools: readonly McpToolExposure[];
}

const EMPTY_FILE: McpToolDenyFile = Object.freeze({
  version: MCP_TOOL_DENY_VERSION,
  servers: Object.freeze({}),
});

export function emptyMcpToolDenyFile(): McpToolDenyFile {
  return EMPTY_FILE;
}

function uniqueNames(names: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of names) {
    if (typeof raw !== "string") continue;
    const name = raw.trim();
    if (name.length === 0 || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

/** Parse a deny-file body. Unknown shapes degrade to empty (fail closed on junk). */
export function parseMcpToolDenyFile(raw: unknown): McpToolDenyFile {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return EMPTY_FILE;
  const obj = raw as Record<string, unknown>;
  if (obj.version !== MCP_TOOL_DENY_VERSION) return EMPTY_FILE;
  const serversRaw = obj.servers;
  if (!serversRaw || typeof serversRaw !== "object" || Array.isArray(serversRaw)) {
    return EMPTY_FILE;
  }
  const servers: Record<string, McpServerToolDeny> = {};
  for (const [name, value] of Object.entries(serversRaw as Record<string, unknown>)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const rec = value as Record<string, unknown>;
    const denied = Array.isArray(rec.deniedTools)
      ? uniqueNames(rec.deniedTools.filter((t): t is string => typeof t === "string"))
      : [];
    const known = Array.isArray(rec.knownTools)
      ? uniqueNames(rec.knownTools.filter((t): t is string => typeof t === "string"))
      : undefined;
    servers[name] = known ? { deniedTools: denied, knownTools: known } : { deniedTools: denied };
  }
  return { version: MCP_TOOL_DENY_VERSION, servers };
}

export function deniedToolsFor(file: McpToolDenyFile, serverName: string): readonly string[] {
  return file.servers[serverName]?.deniedTools ?? [];
}

export function knownToolsFor(file: McpToolDenyFile, serverName: string): readonly string[] {
  return file.servers[serverName]?.knownTools ?? [];
}

/**
 * Tightens-only resolution. A policy-dropped server exposes nothing. A
 * policy-allowed server exposes discovered tools minus user denials. Enable
 * attempts that would loosen the policy or invent tools are rejected.
 */
export function resolveExposedMcpTools(
  input: ResolveExposedMcpToolsInput,
): ResolveExposedMcpToolsResult {
  const discovered = uniqueNames(input.discoveredTools);
  const userDenied = new Set(uniqueNames(input.userDenied));
  const requestedEnable = uniqueNames(input.userRequestedEnable ?? []);

  if (input.policyVerdict === "drop") {
    const tools: McpToolExposure[] = discovered.map((toolName) => ({
      serverName: input.serverName,
      toolName,
      exposed: false,
      reason: "policy-denied" as const,
    }));
    return {
      exposed: [],
      rejectedEnables: requestedEnable,
      tools,
    };
  }

  const rejectedEnables: string[] = [];
  for (const name of requestedEnable) {
    // resolve() never loosens: it will not undeny, and it will not invent tools.
    if (!discovered.includes(name) || userDenied.has(name)) {
      rejectedEnables.push(name);
    }
  }

  const tools: McpToolExposure[] = discovered.map((toolName) => {
    if (userDenied.has(toolName)) {
      return {
        serverName: input.serverName,
        toolName,
        exposed: false,
        reason: "user-denied" as const,
      };
    }
    return {
      serverName: input.serverName,
      toolName,
      exposed: true,
      reason: "allowed" as const,
    };
  });

  return {
    exposed: tools.filter((t) => t.exposed).map((t) => t.toolName),
    rejectedEnables,
    tools,
  };
}

/**
 * Record a per-tool deny/undeny. Undeny of a policy-dropped server is rejected
 * (tightens-only). Returns the next file plus whether the mutation applied.
 */
export function withToolDenied(
  file: McpToolDenyFile,
  input: {
    readonly serverName: string;
    readonly toolName: string;
    readonly denied: boolean;
    readonly policyVerdict: McpPolicyVerdict;
  },
): { readonly file: McpToolDenyFile; readonly applied: boolean; readonly reason: string } {
  const toolName = input.toolName.trim();
  const serverName = input.serverName.trim();
  if (!serverName || !toolName) {
    return { file, applied: false, reason: "missing server or tool name" };
  }
  if (input.policyVerdict === "drop") {
    return {
      file,
      applied: false,
      reason: "policy-denied server: a toggle cannot enable or surface its tools",
    };
  }
  const current = file.servers[serverName] ?? { deniedTools: [] };
  const deniedSet = new Set(current.deniedTools);
  if (input.denied) {
    deniedSet.add(toolName);
  } else {
    deniedSet.delete(toolName);
  }
  const nextServers: Record<string, McpServerToolDeny> = { ...file.servers };
  nextServers[serverName] = {
    deniedTools: [...deniedSet],
    ...(current.knownTools ? { knownTools: current.knownTools } : {}),
  };
  return {
    file: { version: MCP_TOOL_DENY_VERSION, servers: nextServers },
    applied: true,
    reason: input.denied ? "denied" : "undenied",
  };
}

/** Merge newly discovered tool names into the per-server knownTools cache. */
export function withKnownTools(
  file: McpToolDenyFile,
  serverName: string,
  discoveredTools: readonly string[],
): McpToolDenyFile {
  const discovered = uniqueNames(discoveredTools);
  if (discovered.length === 0) return file;
  const current = file.servers[serverName] ?? { deniedTools: [] };
  const merged = uniqueNames([...(current.knownTools ?? []), ...discovered]);
  const nextServers: Record<string, McpServerToolDeny> = { ...file.servers };
  nextServers[serverName] = { deniedTools: current.deniedTools, knownTools: merged };
  return { version: MCP_TOOL_DENY_VERSION, servers: nextServers };
}
