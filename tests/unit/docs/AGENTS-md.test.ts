import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

const repoRoot = resolve(__dirname, "../../..");
const agentsMdPath = resolve(repoRoot, "AGENTS.md");
const claudeMdPath = resolve(repoRoot, "CLAUDE.md");

describe("AGENTS.md canonical agent directive", () => {
  it("exists at the repository root", () => {
    expect(existsSync(agentsMdPath)).toBe(true);
  });

  it("contains every required section heading from the migration spec", () => {
    const body = readFileSync(agentsMdPath, "utf8");
    const required = [
      "Gemma Code Agent Directive",
      "Tech Stack",
      "Project Layout",
      "Key Commands",
      "Non-Obvious Tooling",
      "Communication Style",
      "Critical Rules",
      "Cognitive Workflow",
      "Output Minimization",
      "Module Authorship Contract",
    ];
    for (const marker of required) {
      expect(body, `AGENTS.md is missing required section "${marker}"`).toContain(
        marker,
      );
    }
  });

  it("documents the five-step cognitive workflow", () => {
    const body = readFileSync(agentsMdPath, "utf8");
    for (const step of ["ANALYZE", "PLAN", "EXECUTE", "VERIFY", "PROPAGATE"]) {
      expect(body, `Cognitive workflow step "${step}" missing`).toContain(step);
    }
  });

  it("preserves the no-co-author commit rule from the legacy directive", () => {
    const body = readFileSync(agentsMdPath, "utf8");
    expect(body).toMatch(/Co-Authored-By/);
  });
});

describe("CLAUDE.md is removed (Gemma Code uses agent-agnostic naming)", () => {
  it("does not exist at the repository root", () => {
    expect(existsSync(claudeMdPath)).toBe(false);
  });
});
