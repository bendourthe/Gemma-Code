import { describe, expect, it } from "vitest";

import { createProjectScope, isMcpAllowed, isSkillEnabled, subsetAllowlist, tightenPermission } from "../../../../core/project/ProjectScope.js";

describe("ProjectScope", () => {
  it("owns memory, MCP, skills, and resolved permissions", () => {
    const scope = createProjectScope({
      projectId: "alpha",
      memoryScopeId: "proj:alpha",
      mcpAllowlist: ["nexus-context"],
      skillIds: ["skill-a"],
      permissionFloor: { read_file: 0, run_terminal: 2 },
    });
    expect(scope.memoryScopeId).toBe("proj:alpha");
    expect(scope.mcpAllowlist).toEqual(["nexus-context"]);
    expect(scope.skillIds).toEqual(["skill-a"]);
    expect(scope.permissions.run_terminal).toBe(2);
  });

  it("refuses to loosen a permission below the floor", () => {
    expect(tightenPermission(2, 0)).toBe(2);
    expect(tightenPermission(1, 0)).toBe(1);
    const scope = createProjectScope({
      projectId: "alpha",
      memoryScopeId: "proj:alpha",
      mcpAllowlist: [],
      skillIds: [],
      permissionFloor: { run_terminal: 2 },
      permissionOverrides: { run_terminal: 0 },
    });
    expect(scope.permissions.run_terminal).toBe(2);
  });

  it("allows a tightening override", () => {
    expect(tightenPermission(0, 1)).toBe(1);
    const scope = createProjectScope({
      projectId: "alpha",
      memoryScopeId: "proj:alpha",
      mcpAllowlist: [],
      skillIds: [],
      permissionFloor: { read_file: 0 },
      permissionOverrides: { read_file: 1 },
    });
    expect(scope.permissions.read_file).toBe(1);
  });

  it("drops MCP and skill ids that are not in the parent allowlist", () => {
    expect(subsetAllowlist(["nexus-context"], ["nexus-context", "evil-mcp"])).toEqual([
      "nexus-context",
    ]);
    const scope = createProjectScope({
      projectId: "alpha",
      memoryScopeId: "proj:alpha",
      mcpAllowlist: ["nexus-context", "evil-mcp"],
      skillIds: ["skill-a", "skill-b"],
      permissionFloor: {},
      globalMcpAllowlist: ["nexus-context"],
      globalSkillIds: ["skill-a"],
    });
    expect(scope.mcpAllowlist).toEqual(["nexus-context"]);
    expect(scope.skillIds).toEqual(["skill-a"]);
    expect(isMcpAllowed(scope, "nexus-context")).toBe(true);
    expect(isMcpAllowed(scope, "evil-mcp")).toBe(false);
    expect(isSkillEnabled(scope, "skill-a")).toBe(true);
    expect(isSkillEnabled(scope, "skill-b")).toBe(false);
  });
});
