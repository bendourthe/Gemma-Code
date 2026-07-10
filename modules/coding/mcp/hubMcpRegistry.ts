/**
 * v1.10.0 Phase 3 (T018) -- read the Nexus-Hub MCP registry from the synced
 * catalog subtree and filter it under the MCP Registry Policy.
 *
 * The catalog ships `<catalogRoot>/mcp-configs/mcp-servers.json` (the subdir
 * name is resolved from the version manifest `layout`, not hardcoded). This
 * reader supplies the disk-read half that the pure `filterHubRegistry` expects.
 *
 * IMPORTANT: like `filterHubRegistry`, this only reads + filters the registry
 * into policy-compliant configs. It never connects a server -- connection stays
 * behind the McpManager's per-server enable + workspace-approval gates. Live
 * consumption of the allowed set is wired in a later phase (in-app surface).
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { catalogRoot as resolveCatalogRoot, hubLayoutDir } from "../../../core/storage/paths.js";
import { resolveHubLayout } from "../../../core/storage/hubVersionManifest.js";
import { filterHubRegistry, type HubRegistryFilterResult } from "./HubRegistryPolicyFilter.js";

const EMPTY: HubRegistryFilterResult = { allowed: [], decisions: [] };

/** Resolve `<catalogRoot>/<mcp-configs>/mcp-servers.json` via the layout map. */
export function hubMcpRegistryPath(catalogRootDir: string = resolveCatalogRoot()): string {
  const mcpDir = hubLayoutDir(catalogRootDir, "mcp_configs", resolveHubLayout(catalogRootDir));
  return path.join(mcpDir, "mcp-servers.json");
}

/**
 * Read + policy-filter the Hub MCP registry from the synced catalog. Returns an
 * empty (inert) result when the catalog is not synced or the file is absent or
 * unparseable -- it never throws.
 */
export function readHubMcpRegistry(
  catalogRootDir: string = resolveCatalogRoot(),
): HubRegistryFilterResult {
  let raw: string;
  try {
    raw = fs.readFileSync(hubMcpRegistryPath(catalogRootDir), "utf-8");
  } catch {
    return EMPTY;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return EMPTY;
  }
  return filterHubRegistry(parsed);
}
