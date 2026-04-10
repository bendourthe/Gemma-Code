import { describe, it, expect } from "vitest";
import { buildSubAgentContextMessage, getSubAgentInstructions } from "../../../src/agents/SubAgentPrompts.js";
import type { SubAgentConfig } from "../../../src/agents/types.js";

describe("SubAgentPrompts", () => {
  describe("getSubAgentInstructions", () => {
    it("returns verification instructions for 'verification' type", () => {
      const instructions = getSubAgentInstructions("verification");
      expect(instructions).toContain("verification agent");
      expect(instructions).toContain("bugs");
      expect(instructions).toContain("Do not create or delete files");
    });

    it("returns research instructions for 'research' type", () => {
      const instructions = getSubAgentInstructions("research");
      expect(instructions).toContain("research agent");
      expect(instructions).toContain("Do not modify any files");
    });

    it("returns planning instructions for 'planning' type", () => {
      const instructions = getSubAgentInstructions("planning");
      expect(instructions).toContain("planning agent");
      expect(instructions).toContain("numbered");
      expect(instructions).toContain("Do not modify any files");
    });

    it("falls back to research instructions for unknown type", () => {
      const instructions = getSubAgentInstructions("unknown");
      expect(instructions).toContain("research agent");
    });
  });

  describe("buildSubAgentContextMessage", () => {
    const baseConfig: SubAgentConfig = {
      type: "verification",
      maxIterations: 10,
      userRequest: "Fix the login bug",
      modifiedFiles: [],
      recentToolResults: [],
    };

    it("includes the user request as a task section", () => {
      const msg = buildSubAgentContextMessage(baseConfig);
      expect(msg).toContain("## Task");
      expect(msg).toContain("Fix the login bug");
    });

    it("includes modified files when present", () => {
      const config: SubAgentConfig = {
        ...baseConfig,
        modifiedFiles: ["src/auth.ts", "src/login.ts"],
      };
      const msg = buildSubAgentContextMessage(config);
      expect(msg).toContain("## Modified Files");
      expect(msg).toContain("- src/auth.ts");
      expect(msg).toContain("- src/login.ts");
    });

    it("omits modified files section when empty", () => {
      const msg = buildSubAgentContextMessage(baseConfig);
      expect(msg).not.toContain("## Modified Files");
    });

    it("includes recent tool results when present", () => {
      const config: SubAgentConfig = {
        ...baseConfig,
        recentToolResults: ["[read_file] file content...", "[grep_codebase] found 3 matches"],
      };
      const msg = buildSubAgentContextMessage(config);
      expect(msg).toContain("## Recent Tool Results");
      expect(msg).toContain("[read_file]");
      expect(msg).toContain("[grep_codebase]");
    });

    it("omits recent tool results section when empty", () => {
      const msg = buildSubAgentContextMessage(baseConfig);
      expect(msg).not.toContain("## Recent Tool Results");
    });

    it("includes memory context when provided", () => {
      const config: SubAgentConfig = {
        ...baseConfig,
        memoryContext: "The auth module was refactored last week.",
      };
      const msg = buildSubAgentContextMessage(config);
      expect(msg).toContain("## Relevant Context");
      expect(msg).toContain("refactored last week");
    });

    it("omits memory context section when not provided", () => {
      const msg = buildSubAgentContextMessage(baseConfig);
      expect(msg).not.toContain("## Relevant Context");
    });
  });
});
