import { describe, it, expect } from "vitest";
import {
  PermissionTier,
  getPermissionTier,
  shouldRequireConfirmation,
  getDangerousWarning,
} from "../../../src/guardrails/PermissionTiers.js";
import type { ToolName } from "../../../src/tools/types.js";

describe("PermissionTiers", () => {
  describe("getPermissionTier", () => {
    it("returns AUTO_APPROVE for read-only built-in tools", () => {
      expect(getPermissionTier("read_file")).toBe(PermissionTier.AUTO_APPROVE);
      expect(getPermissionTier("list_directory")).toBe(PermissionTier.AUTO_APPROVE);
      expect(getPermissionTier("grep_codebase")).toBe(PermissionTier.AUTO_APPROVE);
      expect(getPermissionTier("tail_output")).toBe(PermissionTier.AUTO_APPROVE);
      expect(getPermissionTier("grep_output")).toBe(PermissionTier.AUTO_APPROVE);
    });

    it("returns CONFIRM for write built-in tools", () => {
      expect(getPermissionTier("write_file")).toBe(PermissionTier.CONFIRM);
      expect(getPermissionTier("edit_file")).toBe(PermissionTier.CONFIRM);
      expect(getPermissionTier("create_file")).toBe(PermissionTier.CONFIRM);
      expect(getPermissionTier("delete_file")).toBe(PermissionTier.CONFIRM);
    });

    it("returns DANGEROUS for execution/network built-in tools", () => {
      expect(getPermissionTier("run_terminal")).toBe(PermissionTier.DANGEROUS);
      expect(getPermissionTier("web_search")).toBe(PermissionTier.DANGEROUS);
      expect(getPermissionTier("fetch_page")).toBe(PermissionTier.DANGEROUS);
    });

    it("defaults MCP tools to DANGEROUS", () => {
      expect(getPermissionTier("mcp:server/tool" as ToolName)).toBe(PermissionTier.DANGEROUS);
    });

    it("applies user overrides over defaults", () => {
      const overrides = { read_file: PermissionTier.DANGEROUS };
      expect(getPermissionTier("read_file", overrides)).toBe(PermissionTier.DANGEROUS);
    });

    it("ignores invalid override values", () => {
      const overrides = { read_file: 99 };
      expect(getPermissionTier("read_file", overrides)).toBe(PermissionTier.AUTO_APPROVE);
    });
  });

  describe("shouldRequireConfirmation", () => {
    it("returns false for AUTO_APPROVE tools", () => {
      expect(shouldRequireConfirmation("read_file")).toBe(false);
      expect(shouldRequireConfirmation("list_directory")).toBe(false);
    });

    it("returns true for CONFIRM tools", () => {
      expect(shouldRequireConfirmation("write_file")).toBe(true);
      expect(shouldRequireConfirmation("edit_file")).toBe(true);
    });

    it("returns true for DANGEROUS tools", () => {
      expect(shouldRequireConfirmation("run_terminal")).toBe(true);
      expect(shouldRequireConfirmation("fetch_page")).toBe(true);
    });

    it("clamps tier-2 overrides to CONFIRM (cannot drop tier-2 to auto-approve)", () => {
      // Phase 1.2 (v0.6.0) clamp: pen-test F-003 / Attack Path A auto-approve leg.
      const overrides = { run_terminal: PermissionTier.AUTO_APPROVE };
      expect(shouldRequireConfirmation("run_terminal", overrides)).toBe(true);
    });

    it("honors override that elevates baseline (no upper clamp)", () => {
      const overrides = { read_file: PermissionTier.DANGEROUS };
      expect(shouldRequireConfirmation("read_file", overrides)).toBe(true);
    });

    // -----------------------------------------------------------------------
    // Phase 7.6 mutation-test pinning: surviving mutants in PermissionTiers
    // that loosened the clamp boundary. Each test below kills one specific
    // mutant identified by the v0.6.0 Stryker pass. Do not delete without
    // re-running mutation testing.
    // -----------------------------------------------------------------------

    it("clamps a CONFIRM-baseline tool whose override drops to AUTO_APPROVE", () => {
      // Pins line 58 EqualityOperator mutation: `baseline >= CONFIRM` mutated
      // to `>` would let write_file (CONFIRM baseline) silently drop to
      // AUTO_APPROVE. That re-opens the auto-approve attack leg for write
      // tools, not just for the originally-targeted run_terminal.
      const overrides = { write_file: PermissionTier.AUTO_APPROVE };
      expect(shouldRequireConfirmation("write_file", overrides)).toBe(true);
      expect(getPermissionTier("write_file", overrides)).toBe(PermissionTier.CONFIRM);
    });

    it("clamps every CONFIRM-baseline file tool when overridden to AUTO_APPROVE", () => {
      // Same boundary as above, exhaustive across the CONFIRM-baseline tools.
      // A relaxed clamp (>= -> >) would silently downgrade any of these.
      for (const tool of ["write_file", "edit_file", "create_file", "delete_file"] as const) {
        const overrides = { [tool]: PermissionTier.AUTO_APPROVE };
        expect(shouldRequireConfirmation(tool, overrides)).toBe(true);
      }
    });

    it("does not clamp an override that already equals the baseline tier", () => {
      // Pins line 59 EqualityOperator mutation: `override < CONFIRM` mutated
      // to `<=` would silently re-classify a CONFIRM override on a CONFIRM
      // baseline. The override must be honoured exactly.
      const overrides = { write_file: PermissionTier.CONFIRM };
      expect(getPermissionTier("write_file", overrides)).toBe(PermissionTier.CONFIRM);
    });

    it("ignores override values outside the {0,1,2} domain", () => {
      // Pins line 55 ConditionalExpression / LogicalOperator mutations:
      // dropping the domain check would let a stray `99` or negative number
      // bypass the baseline. The expected behavior is a fall-through to
      // baseline as if no override were present.
      expect(getPermissionTier("read_file", { read_file: 99 })).toBe(PermissionTier.AUTO_APPROVE);
      expect(getPermissionTier("write_file", { write_file: -1 })).toBe(PermissionTier.CONFIRM);
      expect(getPermissionTier("run_terminal", { run_terminal: 5 })).toBe(PermissionTier.DANGEROUS);
    });
  });

  describe("getDangerousWarning", () => {
    it("returns command text for run_terminal", () => {
      const warning = getDangerousWarning("run_terminal", { command: "rm -rf /" });
      expect(warning).toContain("rm -rf /");
      expect(warning).toContain("execute a shell command");
    });

    it("returns query text for web_search", () => {
      const warning = getDangerousWarning("web_search", { query: "test query" });
      expect(warning).toContain("test query");
    });

    it("returns url for fetch_page", () => {
      const warning = getDangerousWarning("fetch_page", { url: "https://example.com" });
      expect(warning).toContain("https://example.com");
    });

    it("returns generic warning for MCP tools", () => {
      const warning = getDangerousWarning("mcp:server/tool" as ToolName, {});
      expect(warning).toContain("elevated permission");
    });

    it("returns empty string for non-DANGEROUS tools", () => {
      expect(getDangerousWarning("read_file", {})).toBe("");
      expect(getDangerousWarning("write_file", {})).toBe("");
    });
  });
});
