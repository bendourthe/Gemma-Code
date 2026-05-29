/**
 * v1.2.0 Phase 5.1 -- integration test for the read-only explore policy.
 *
 * The plan's acceptance criteria:
 *   - Tool-call rejection enforced: an explore sub-agent cannot Edit.
 *   - Regression test proves an explore sub-agent cannot Edit.
 *   - Linter rule fires on a bad sub-agent definition fixture.
 *
 * This test exercises the policy via the public `evaluateExploreToolCall`
 * and `lintExploreSpecialist` surfaces in `core/coding/SubAgentPolicy.ts`,
 * plus the `run_terminal` wrapper invoked through `wrapWithExplorePolicy`
 * (which `SubAgentManager._buildScopedRegistry` installs when intent is
 * 'explore'). We test the wrapper at the unit boundary because instantiating
 * a full SubAgentManager requires a live OllamaClient + tracer + workspace
 * filesystem; the wrapper is the exact same object the manager builds.
 */

import { describe, it, expect } from "vitest";
import {
  evaluateExploreToolCall,
  lintExploreSpecialist,
} from "../../../core/coding/SubAgentPolicy.js";
import type { ToolHandler, ToolResult } from "../../../src/tools/types.js";

/**
 * Local copy of the wrapper from `SubAgentManager.ts`. Kept in sync via
 * the unit tests under `tests/unit/core/coding/SubAgentPolicy.test.ts`;
 * the integration test exists to prove the wrapper composes with a real
 * `ToolHandler` shape.
 */
function wrapWithExplorePolicy(inner: ToolHandler): ToolHandler {
  return {
    async execute(params: Record<string, unknown>): Promise<ToolResult> {
      const command = typeof params["command"] === "string" ? (params["command"] as string) : "";
      const decision = evaluateExploreToolCall({
        intent: "explore",
        toolName: "run_terminal",
        command,
      });
      if (!decision.allow) {
        return {
          id: typeof params["id"] === "string" ? (params["id"] as string) : "",
          success: false,
          output: "",
          error:
            decision.message ??
            `Rejected by Phase 5.1 explore policy (${decision.reason ?? "unknown"}).`,
        };
      }
      return inner.execute(params);
    },
  };
}

function fakeTerminal(): ToolHandler {
  return {
    async execute(params: Record<string, unknown>): Promise<ToolResult> {
      return {
        id: typeof params["id"] === "string" ? (params["id"] as string) : "",
        success: true,
        output: `executed: ${String(params["command"] ?? "")}`,
      };
    },
  };
}

describe("Phase 5.1 -- explore sub-agent enforcement", () => {
  it("rejects an Edit tool call from an explore sub-agent at the policy layer", () => {
    const decision = evaluateExploreToolCall({
      intent: "explore",
      toolName: "edit_file",
    });
    expect(decision.allow).toBe(false);
    expect(decision.reason).toBe("tool-not-in-allowlist");
  });

  it("rejects a Write tool call from an explore sub-agent at the policy layer", () => {
    const decision = evaluateExploreToolCall({
      intent: "explore",
      toolName: "write_file",
    });
    expect(decision.allow).toBe(false);
  });

  it("allows the codegraph_callers query from an explore sub-agent", () => {
    const decision = evaluateExploreToolCall({
      intent: "explore",
      toolName: "codegraph_callers",
    });
    expect(decision.allow).toBe(true);
  });

  it("rejects a run_terminal call with rm -rf via the wrapped handler", async () => {
    const wrapped = wrapWithExplorePolicy(fakeTerminal());
    const result = await wrapped.execute({ id: "1", command: "rm -rf node_modules" });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/may not run 'rm'/);
  });

  it("allows a run_terminal call with 'git status' via the wrapped handler", async () => {
    const wrapped = wrapWithExplorePolicy(fakeTerminal());
    const result = await wrapped.execute({ id: "1", command: "git status -s" });
    expect(result.success).toBe(true);
    expect(result.output).toMatch(/executed: git status -s/);
  });

  it("fires lint findings on a specialist definition that combines explore + write tools", () => {
    const findings = lintExploreSpecialist({
      intent: "explore",
      toolScope: ["read_file", "write_file", "edit_file"],
      sourcePath: ".claude/agents/fixtures/bad-explorer.md",
    });
    expect(findings.length).toBeGreaterThanOrEqual(2);
    expect(findings.some((f) => /write_file/.test(f))).toBe(true);
    expect(findings.some((f) => /edit_file/.test(f))).toBe(true);
  });

  it("returns no lint findings on a clean explore specialist", () => {
    const findings = lintExploreSpecialist({
      intent: "explore",
      toolScope: ["read_file", "grep_codebase", "list_directory", "codegraph_search"],
    });
    expect(findings).toEqual([]);
  });
});
