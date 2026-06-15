/**
 * v1.5.0 Phase 7 (HUB.P3.MCPCFG) -- consume the Nexus-Hub MCP registry under
 * the MCP Registry Policy.
 *
 * The Hub ships `catalog/mcp-configs/mcp-servers.json`. Per AGENTS.md, only two
 * buckets may be consumed: `already-local` (internal Nexus servers + zero-outbound
 * Anthropic-official servers) and `vendor-intrinsic` (your-own-account wrappers
 * whose `_comment` justifies the destination). Everything else --
 * search/embeddings/scraping/generation-as-service, or anything unclassified --
 * is dropped. This filter enforces that decision tree so a future or tampered
 * registry can never introduce a disallowed outbound server.
 *
 * IMPORTANT: this only *filters* the registry into policy-compliant configs. It
 * never connects a server -- connection stays behind the McpManager's existing
 * per-server enable + workspace-approval gates.
 */

import type { McpServerConfig } from "./McpTypes.js";

export type McpPolicyVerdict = "allow" | "drop";

export interface McpPolicyDecision {
  readonly name: string;
  readonly classification: string;
  readonly verdict: McpPolicyVerdict;
  readonly reason: string;
}

export interface HubRegistryFilterResult {
  /** Policy-compliant server configs, validated to the McpManager shape. */
  readonly allowed: McpServerConfig[];
  /** Per-server decisions (allow + drop), for logging / the integration delta. */
  readonly decisions: McpPolicyDecision[];
}

/** Classifications the policy permits to be consumed. */
const ALLOWED_CLASSIFICATIONS = new Set(["already-local", "vendor-intrinsic"]);

/** Pull `Classification: <x>` out of a server's `_comment`. */
export function readClassification(comment: unknown): string {
  if (typeof comment !== "string") return "";
  const m = /Classification:\s*([a-z0-9-]+)/i.exec(comment);
  return m?.[1] ? m[1].toLowerCase() : "";
}

interface RawServer {
  command?: unknown;
  args?: unknown;
  env?: unknown;
  transport?: unknown;
  _comment?: unknown;
}

/** Decide allow/drop for one Hub registry server. */
export function classifyHubMcpServer(name: string, raw: RawServer): McpPolicyDecision {
  const classification = readClassification(raw._comment) || "unclassified";
  if (!ALLOWED_CLASSIFICATIONS.has(classification)) {
    return {
      name,
      classification,
      verdict: "drop",
      reason:
        classification === "unclassified"
          ? "no Classification in _comment; dropped (policy default-deny)"
          : `classification '${classification}' is not consumable per the MCP Registry Policy`,
    };
  }
  // vendor-intrinsic must carry a justification comment (the 5-question audit).
  if (classification === "vendor-intrinsic" && typeof raw._comment !== "string") {
    return { name, classification, verdict: "drop", reason: "vendor-intrinsic without a justifying _comment" };
  }
  if (typeof raw.command !== "string" || raw.command.length === 0) {
    return { name, classification, verdict: "drop", reason: "missing command" };
  }
  return { name, classification, verdict: "allow", reason: `classification '${classification}' is consumable` };
}

/** Coerce an allowed raw server into the McpManager config shape. */
function toServerConfig(name: string, raw: RawServer): McpServerConfig | null {
  if (typeof raw.command !== "string") return null;
  const args =
    Array.isArray(raw.args) && raw.args.every((a) => typeof a === "string")
      ? (raw.args as string[])
      : undefined;
  let env: Record<string, string> | undefined;
  if (raw.env && typeof raw.env === "object") {
    env = {};
    for (const [k, v] of Object.entries(raw.env as Record<string, unknown>)) {
      // Only SHOUTING_SNAKE_CASE keys with string values survive (McpManager schema).
      if (/^[A-Z][A-Z0-9_]*$/.test(k) && typeof v === "string") env[k] = v;
    }
  }
  return { name, command: raw.command, args, transport: "stdio", env };
}

/**
 * Filter a parsed Hub `mcp-servers.json` object into policy-compliant configs.
 * Accepts either a `{ mcpServers: {...} }` / `{ servers: {...} }` wrapper or a
 * bare name->config map.
 */
export function filterHubRegistry(registry: unknown): HubRegistryFilterResult {
  const decisions: McpPolicyDecision[] = [];
  const allowed: McpServerConfig[] = [];
  const obj = registry as Record<string, unknown> | null;
  const servers =
    (obj?.mcpServers as Record<string, unknown>) ??
    (obj?.servers as Record<string, unknown>) ??
    (obj as Record<string, unknown>) ??
    {};
  for (const [name, value] of Object.entries(servers)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const raw = value as RawServer;
    // Skip non-server scalar metadata fields on a bare map.
    if (raw.command === undefined && raw._comment === undefined) continue;
    const decision = classifyHubMcpServer(name, raw);
    decisions.push(decision);
    if (decision.verdict === "allow") {
      const cfg = toServerConfig(name, raw);
      if (cfg) allowed.push(cfg);
    }
  }
  decisions.sort((a, b) => a.name.localeCompare(b.name));
  allowed.sort((a, b) => a.name.localeCompare(b.name));
  return { allowed, decisions };
}
