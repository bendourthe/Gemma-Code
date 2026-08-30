/**
 * v1.18.0 Phase 3 (OW-A5) -- per-project MCP registry settings list + deny.
 *
 * Combines user `mcp.json` servers, the Hub registry policy decisions, and
 * `.nexus/mcp-tool-deny.json` into the shape the desktop Settings tab renders.
 * vscode-free; no MCP process is spawned.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { readHubMcpRegistry } from "./hubMcpRegistry.js";
import type { HubRegistryFilterResult } from "./HubRegistryPolicyFilter.js";
import {
  deniedToolsFor,
  emptyMcpToolDenyFile,
  knownToolsFor,
  resolveExposedMcpTools,
  withToolDenied,
  type McpPolicyVerdict,
  type McpToolDenyFile,
} from "./McpToolDeny.js";
import { readMcpToolDenyFile, writeMcpToolDenyFile } from "./McpToolDenyStore.js";

export interface McpRegistryToolDto {
  readonly name: string;
  readonly exposed: boolean;
  readonly reason: "allowed" | "user-denied" | "policy-denied";
  /** False when Hub policy dropped the server: the checkbox cannot enable it. */
  readonly toggleable: boolean;
}

export interface McpRegistryServerDto {
  readonly name: string;
  readonly source: "user" | "hub";
  readonly policyVerdict: McpPolicyVerdict;
  readonly policyReason: string;
  readonly tools: readonly McpRegistryToolDto[];
}

export interface McpRegistryListDto {
  readonly servers: readonly McpRegistryServerDto[];
}

function readUserMcpJson(filePath: string): Array<{ name: string }> {
  try {
    if (!fs.existsSync(filePath)) return [];
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as {
      servers?: Array<{ name?: string }>;
    };
    if (!Array.isArray(parsed.servers)) return [];
    return parsed.servers
      .filter((s): s is { name: string } => typeof s?.name === "string" && s.name.length > 0)
      .map((s) => ({ name: s.name }));
  } catch {
    return [];
  }
}

export function loadUserMcpServers(workspacePath: string): readonly { name: string }[] {
  return loadUserMcpServersForRoots(workspacePath ? [workspacePath] : []);
}

export function loadUserMcpServersForRoots(workspaceRoots: readonly string[]): readonly { name: string }[] {
  const byName = new Map<string, { name: string }>();
  for (const cfg of readUserMcpJson(path.join(os.homedir(), ".nexus", "mcp.json"))) {
    byName.set(cfg.name, cfg);
  }
  for (const workspacePath of workspaceRoots) {
    if (workspacePath) {
      for (const cfg of readUserMcpJson(path.join(workspacePath, ".nexus", "mcp.json"))) {
        byName.set(cfg.name, cfg);
      }
    }
  }
  return [...byName.values()];
}

function mergedDenyFiles(workspaceRoots: readonly string[]): McpToolDenyFile {
  const servers: Record<string, { deniedTools: string[]; knownTools: string[] }> = {};
  for (const root of workspaceRoots) {
    const file = readMcpToolDenyFile(root);
    for (const [name, policy] of Object.entries(file.servers)) {
      const current = servers[name] ?? { deniedTools: [], knownTools: [] };
      current.deniedTools = unique([...current.deniedTools, ...policy.deniedTools]);
      current.knownTools = unique([...current.knownTools, ...(policy.knownTools ?? [])]);
      servers[name] = current;
    }
  }
  return { version: 1, servers };
}

function toolsForServer(
  name: string,
  verdict: McpPolicyVerdict,
  deny: McpToolDenyFile,
): McpRegistryToolDto[] {
  const discovered = unique([
    ...knownToolsFor(deny, name),
    ...deniedToolsFor(deny, name),
  ]);
  const resolved = resolveExposedMcpTools({
    serverName: name,
    policyVerdict: verdict,
    discoveredTools: discovered,
    userDenied: deniedToolsFor(deny, name),
  });
  const toggleable = verdict === "allow";
  return resolved.tools.map((t) => ({
    name: t.toolName,
    exposed: t.exposed,
    reason: t.reason,
    toggleable,
  }));
}

function unique(names: readonly string[]): string[] {
  return [...new Set(names.filter((n) => n.length > 0))];
}

export function listMcpRegistrySettings(opts: {
  readonly workspacePath: string;
  readonly workspaceRoots?: readonly string[];
  readonly hub?: HubRegistryFilterResult;
  readonly userServers?: readonly { name: string }[];
}): McpRegistryListDto {
  const workspaceRoots = opts.workspaceRoots?.length ? opts.workspaceRoots : opts.workspacePath ? [opts.workspacePath] : [];
    const deny = workspaceRoots.length
      ? mergedDenyFiles(workspaceRoots)
      : emptyMcpToolDenyFile();
  const hub = opts.hub ?? (opts.workspacePath ? readHubMcpRegistry() : { allowed: [], decisions: [] });
  const userServers = opts.userServers ?? loadUserMcpServersForRoots(workspaceRoots);
  const servers: McpRegistryServerDto[] = [];
  const seen = new Set<string>();

  for (const cfg of userServers) {
    seen.add(cfg.name);
    servers.push({
      name: cfg.name,
      source: "user",
      policyVerdict: "allow",
      policyReason: "user-registered mcp.json server",
      tools: toolsForServer(cfg.name, "allow", deny),
    });
  }

  for (const decision of hub.decisions) {
    if (seen.has(decision.name)) continue;
    seen.add(decision.name);
    servers.push({
      name: decision.name,
      source: "hub",
      policyVerdict: decision.verdict,
      policyReason: decision.reason,
      tools: toolsForServer(decision.name, decision.verdict, deny),
    });
  }

  servers.sort((a, b) => a.name.localeCompare(b.name));
  return { servers };
}

export function setMcpRegistryToolDenied(opts: {
  readonly workspacePath: string;
  readonly workspaceRoots?: readonly string[];
  readonly serverName: string;
  readonly toolName: string;
  readonly denied: boolean;
  readonly hub?: HubRegistryFilterResult;
  readonly userServers?: readonly { name: string }[];
}): { readonly ok: boolean; readonly reason: string; readonly list: McpRegistryListDto } {
  const listBefore = listMcpRegistrySettings(opts);
  const server = listBefore.servers.find((s) => s.name === opts.serverName);
  const verdict: McpPolicyVerdict = server?.policyVerdict ?? "drop";
  const current = readMcpToolDenyFile(opts.workspacePath);
  const result = withToolDenied(current, {
    serverName: opts.serverName,
    toolName: opts.toolName,
    denied: opts.denied,
    policyVerdict: verdict,
  });
  if (result.applied) {
    writeMcpToolDenyFile(opts.workspacePath, result.file);
  }
  return {
    ok: result.applied,
    reason: result.reason,
    list: listMcpRegistrySettings(opts),
  };
}
