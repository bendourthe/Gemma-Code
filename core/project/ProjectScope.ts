/**
 * v2.0.0 Phase 4.1 -- one owned object for a project's memory scope, MCP
 * allowlist, skill set, and permission overrides.
 *
 * Permission deltas are tightening-only: an override may raise a tool's
 * floor (AUTO_APPROVE -> CONFIRM -> DANGEROUS) but never lower it. MCP
 * and skill lists are subsets of the global sets. No multi-user grants.
 */

export type PermissionLevel = 0 | 1 | 2;

export interface ProjectScopeInput {
  readonly projectId: string;
  readonly memoryScopeId: string;
  readonly mcpAllowlist: readonly string[];
  readonly skillIds: readonly string[];
  readonly permissionFloor: Readonly<Record<string, PermissionLevel>>;
  readonly permissionOverrides?: Readonly<Record<string, PermissionLevel>>;
  /** When set, requested MCP ids that are not in this parent list are dropped. */
  readonly globalMcpAllowlist?: readonly string[];
  /** When set, requested skill ids that are not in this parent list are dropped. */
  readonly globalSkillIds?: readonly string[];
}

export interface ProjectScope {
  readonly projectId: string;
  readonly memoryScopeId: string;
  readonly mcpAllowlist: readonly string[];
  readonly skillIds: readonly string[];
  readonly permissions: Readonly<Record<string, PermissionLevel>>;
}

export function tightenPermission(
  floor: PermissionLevel,
  override: PermissionLevel | undefined,
): PermissionLevel {
  if (override === undefined) return floor;
  return override > floor ? override : floor;
}

export function subsetAllowlist(
  parent: readonly string[],
  requested: readonly string[],
): readonly string[] {
  const allowed = new Set(parent);
  return requested.filter((id) => allowed.has(id));
}

export function createProjectScope(input: ProjectScopeInput): ProjectScope {
  const permissions: Record<string, PermissionLevel> = {};
  const tools = new Set([
    ...Object.keys(input.permissionFloor),
    ...Object.keys(input.permissionOverrides ?? {}),
  ]);
  for (const tool of tools) {
    const floor = input.permissionFloor[tool] ?? 2;
    permissions[tool] = tightenPermission(floor, input.permissionOverrides?.[tool]);
  }
  const mcpAllowlist =
    input.globalMcpAllowlist === undefined
      ? [...input.mcpAllowlist]
      : [...subsetAllowlist(input.globalMcpAllowlist, input.mcpAllowlist)];
  const skillIds =
    input.globalSkillIds === undefined
      ? [...input.skillIds]
      : [...subsetAllowlist(input.globalSkillIds, input.skillIds)];
  return {
    projectId: input.projectId,
    memoryScopeId: input.memoryScopeId,
    mcpAllowlist,
    skillIds,
    permissions,
  };
}

export function isMcpAllowed(scope: ProjectScope, serverId: string): boolean {
  return scope.mcpAllowlist.includes(serverId);
}

export function isSkillEnabled(scope: ProjectScope, skillId: string): boolean {
  return scope.skillIds.includes(skillId);
}
