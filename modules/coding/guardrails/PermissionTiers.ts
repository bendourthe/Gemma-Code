import type { BuiltinToolName, ToolName } from "../../../src/tools/types.js";
import { isAllowlisted } from "../../../src/tools/handlers/terminal.js";
import { getLogger } from "../utils/logger.js";

/**
 * v1.16.0 Phase 4 (A6): the enum + map moved to `permissionTierMap.ts`, which
 * imports nothing that can pull `vscode` in, so the headless tool surface can
 * share the SAME tier data instead of keeping a second copy that would drift.
 * Re-exported here so every existing importer is unchanged, and so this module
 * remains the behavioral home (overrides, clamping, warnings).
 */
export { PermissionTier } from "./permissionTierMap.js";
import { PermissionTier, TOOL_PERMISSION_MAP } from "./permissionTierMap.js";
import {
  confirmationRequiredForPosture,
  parseSecurityPosture,
  type SecurityPostureId,
} from "./SecurityPosture.js";

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
 * AUTO_APPROVE tools never require confirmation. DANGEROUS always does (the
 * floor clamp). CONFIRM follows the security-posture dial: Unattended skips
 * CONFIRM prompts; Strict and Standard keep them. Hard denials are a separate
 * path and are not consulted here.
 */
export function shouldRequireConfirmation(
  toolName: ToolName,
  userOverrides?: Record<string, number>,
  posture: SecurityPostureId | string = "standard",
): boolean {
  // Baseline DANGEROUS tools (terminal, web) always confirm. An override may
  // lower the mapped tier to CONFIRM, but Unattended must not treat that as a
  // skippable prompt -- that would be a no-floor path.
  if (getBaselineTier(toolName) === PermissionTier.DANGEROUS) return true;
  const tier = getPermissionTier(toolName, userOverrides);
  return confirmationRequiredForPosture(tier, parseSecurityPosture(posture));
}

/**
 * Generate a human-readable warning string for DANGEROUS-tier tools.
 * Returns an empty string for non-DANGEROUS tools.
 */
export function getDangerousWarning(
  toolName: ToolName,
  parameters: Record<string, unknown>,
  sandboxSummary?: string,
): string {
  const tier = getPermissionTier(toolName);
  if (tier !== PermissionTier.DANGEROUS) return "";

  switch (toolName) {
    case "run_terminal": {
      const cmd = String(parameters["command"] ?? "(unknown)");
      const prefix = isAllowlisted(cmd)
        ? "This will execute a shell command"
        : "This will execute a shell command OUTSIDE the allowlist";
      const base = `${prefix}: ${cmd}`;
      return sandboxSummary ? `${base}\n${sandboxSummary}` : base;
    }
    case "web_search":
      return `This will perform a web search: ${String(parameters["query"] ?? "(unknown)")}`;
    case "fetch_page":
      return `This will fetch a web page: ${String(parameters["url"] ?? "(unknown)")}`;
    case "browser_navigate":
      return `This will open a URL in the isolated Nexus browser profile (not your default Chrome): ${String(parameters["url"] ?? "(unknown)")}`;
    case "browser_click":
      return `This will click ${String(parameters["selector"] ?? "(unknown)")} in the isolated Nexus browser profile.`;
    case "browser_type":
      return `This will type into ${String(parameters["selector"] ?? "(unknown)")} in the isolated Nexus browser profile.`;
    case "browser_aria_snapshot":
      return "This will read an ARIA snapshot from the isolated Nexus browser profile. Page content is untrusted.";
    case "browser_close":
      return "This will close the isolated Nexus browser session.";
    default:
      return `Tool "${toolName}" requires elevated permission (DANGEROUS tier).`;
  }
}
