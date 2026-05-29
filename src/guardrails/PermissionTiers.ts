import type { BuiltinToolName, ToolName } from "../tools/types.js";
import { isAllowlisted } from "../tools/handlers/terminal.js";
import { getLogger } from "../../modules/coding/utils/logger.js";

export enum PermissionTier {
  AUTO_APPROVE = 0,
  CONFIRM = 1,
  DANGEROUS = 2,
}

const TOOL_PERMISSION_MAP: Record<BuiltinToolName, PermissionTier> = {
  read_file: PermissionTier.AUTO_APPROVE,
  list_directory: PermissionTier.AUTO_APPROVE,
  grep_codebase: PermissionTier.AUTO_APPROVE,
  tail_output: PermissionTier.AUTO_APPROVE,
  grep_output: PermissionTier.AUTO_APPROVE,
  write_file: PermissionTier.CONFIRM,
  edit_file: PermissionTier.CONFIRM,
  create_file: PermissionTier.CONFIRM,
  delete_file: PermissionTier.CONFIRM,
  run_terminal: PermissionTier.DANGEROUS,
  web_search: PermissionTier.DANGEROUS,
  fetch_page: PermissionTier.DANGEROUS,
  compress_range: PermissionTier.AUTO_APPROVE,
  compress_message: PermissionTier.AUTO_APPROVE,
  update_todos: PermissionTier.AUTO_APPROVE,
  // v1.2.0 Phase 3.5: codegraph_* tools are read-only over a local SQLite
  // file (no network, no working-tree mutation), so they sit at the
  // AUTO_APPROVE tier alongside read_file and grep_codebase.
  codegraph_search: PermissionTier.AUTO_APPROVE,
  codegraph_context: PermissionTier.AUTO_APPROVE,
  codegraph_trace: PermissionTier.AUTO_APPROVE,
  codegraph_callers: PermissionTier.AUTO_APPROVE,
  codegraph_callees: PermissionTier.AUTO_APPROVE,
  codegraph_impact: PermissionTier.AUTO_APPROVE,
  codegraph_node: PermissionTier.AUTO_APPROVE,
  codegraph_explore: PermissionTier.AUTO_APPROVE,
  codegraph_files: PermissionTier.AUTO_APPROVE,
};

/** Baseline tier for any tool, including unknown/MCP tools. */
function getBaselineTier(toolName: ToolName): PermissionTier {
  if (toolName in TOOL_PERMISSION_MAP) {
    return TOOL_PERMISSION_MAP[toolName as BuiltinToolName];
  }
  // MCP tools and unknowns default to DANGEROUS.
  return PermissionTier.DANGEROUS;
}

// Dedupe identical clamp warnings so a settings.json with a permanent override
// does not flood the output channel on every tool execution.
const _warnedOverrides = new Set<string>();

/**
 * Get the permission tier for a tool. Built-in tools are looked up from the
 * static map; MCP tools (prefixed "mcp:") default to DANGEROUS.
 *
 * permissionOverrides clamp: a tool whose baseline tier requires confirmation
 * (CONFIRM or DANGEROUS) cannot be dropped to AUTO_APPROVE via overrides. A
 * workspace-level `.vscode/settings.json` that tries to silently auto-approve
 * `run_terminal` or `delete_file` is neutralized at runtime. Closes Attack
 * Path A's auto-approve leg (pen-test F-003).
 */
export function getPermissionTier(
  toolName: ToolName,
  userOverrides?: Record<string, number>,
): PermissionTier {
  if (userOverrides && toolName in userOverrides) {
    const override = userOverrides[toolName];
    if (override === 0 || override === 1 || override === 2) {
      const baseline = getBaselineTier(toolName);
      if (
        baseline >= PermissionTier.CONFIRM &&
        override < PermissionTier.CONFIRM
      ) {
        const dedupeKey = `${toolName}=${override}`;
        if (!_warnedOverrides.has(dedupeKey)) {
          _warnedOverrides.add(dedupeKey);
          getLogger().warn(
            `permissionOverride for ${toolName}=${override} clamped to 1; tools requiring confirmation cannot be auto-approved.`,
          );
        }
        return PermissionTier.CONFIRM;
      }
      return override as PermissionTier;
    }
  }

  return getBaselineTier(toolName);
}

/** Test-only helper: reset the warned-overrides dedupe set. */
export function _resetPermissionOverrideWarnings(): void {
  _warnedOverrides.clear();
}

/**
 * Determine whether a tool call should require user confirmation.
 * AUTO_APPROVE tools never require confirmation; CONFIRM and DANGEROUS do.
 */
export function shouldRequireConfirmation(
  toolName: ToolName,
  userOverrides?: Record<string, number>,
): boolean {
  const tier = getPermissionTier(toolName, userOverrides);
  return tier >= PermissionTier.CONFIRM;
}

/**
 * Generate a human-readable warning string for DANGEROUS-tier tools.
 * Returns an empty string for non-DANGEROUS tools.
 */
export function getDangerousWarning(
  toolName: ToolName,
  parameters: Record<string, unknown>,
): string {
  const tier = getPermissionTier(toolName);
  if (tier !== PermissionTier.DANGEROUS) return "";

  switch (toolName) {
    case "run_terminal": {
      const cmd = String(parameters["command"] ?? "(unknown)");
      const prefix = isAllowlisted(cmd)
        ? "This will execute a shell command"
        : "This will execute a shell command OUTSIDE the allowlist";
      return `${prefix}: ${cmd}`;
    }
    case "web_search":
      return `This will perform a web search: ${String(parameters["query"] ?? "(unknown)")}`;
    case "fetch_page":
      return `This will fetch a web page: ${String(parameters["url"] ?? "(unknown)")}`;
    default:
      return `Tool "${toolName}" requires elevated permission (DANGEROUS tier).`;
  }
}
