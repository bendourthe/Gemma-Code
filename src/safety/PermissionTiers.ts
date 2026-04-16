import type { BuiltinToolName, ToolName } from "../tools/types.js";

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
  get_tool_schema: PermissionTier.AUTO_APPROVE,
  write_file: PermissionTier.CONFIRM,
  edit_file: PermissionTier.CONFIRM,
  create_file: PermissionTier.CONFIRM,
  delete_file: PermissionTier.CONFIRM,
  run_terminal: PermissionTier.DANGEROUS,
  web_search: PermissionTier.DANGEROUS,
  fetch_page: PermissionTier.DANGEROUS,
};

/**
 * Get the permission tier for a tool. Built-in tools are looked up from the
 * static map; MCP tools (prefixed "mcp:") default to DANGEROUS.
 */
export function getPermissionTier(
  toolName: ToolName,
  userOverrides?: Record<string, number>,
): PermissionTier {
  // User overrides take precedence.
  if (userOverrides && toolName in userOverrides) {
    const override = userOverrides[toolName];
    if (override === 0 || override === 1 || override === 2) {
      return override as PermissionTier;
    }
  }

  if (toolName in TOOL_PERMISSION_MAP) {
    return TOOL_PERMISSION_MAP[toolName as BuiltinToolName];
  }

  // MCP tools and unknowns default to DANGEROUS.
  return PermissionTier.DANGEROUS;
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
    case "run_terminal":
      return `This will execute a shell command: ${String(parameters["command"] ?? "(unknown)")}`;
    case "web_search":
      return `This will perform a web search: ${String(parameters["query"] ?? "(unknown)")}`;
    case "fetch_page":
      return `This will fetch a web page: ${String(parameters["url"] ?? "(unknown)")}`;
    default:
      return `Tool "${toolName}" requires elevated permission (DANGEROUS tier).`;
  }
}
