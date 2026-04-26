/**
 * Characterization tests for sub-agent system prompts.
 *
 * These tests lock the *current* output of the prompt-building pipeline used
 * by SubAgentManager, before the Phase 8 specialist-externalization refactor.
 * They MUST continue to pass byte-equivalent after the refactor; any drift
 * indicates the externalization changed observable behavior.
 *
 * Why characterization tests, not unit tests:
 *   - The bundled-Markdown specialist files (`assets/specialists/*.md`) are
 *     the only thing being introduced. Their *content* must reproduce the
 *     hardcoded prompt strings verbatim. A snapshot is the cheapest way to
 *     prove that property; a hand-written assertion would drift silently.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { PromptBuilder } from "../../../src/chat/PromptBuilder.js";
import { TOOL_CATALOG, toDynamicMetadata } from "../../../src/tools/ToolCatalog.js";
import {
  buildSubAgentContextMessage,
  getSubAgentInstructions,
} from "../../../src/agents/SubAgentPrompts.js";
import type { SubAgentConfig, SubAgentType } from "../../../src/agents/types.js";

const SNAPSHOT_DIR = path.resolve(__dirname, "../../snapshots/specialists");

/** Tools available to each sub-agent type, mirroring TOOLS_BY_TYPE in SubAgentManager. */
const TOOLS_BY_TYPE: Record<SubAgentType, readonly string[]> = {
  verification: ["read_file", "grep_codebase", "list_directory", "run_terminal"],
  research: ["read_file", "grep_codebase", "list_directory", "web_search", "fetch_page"],
  planning: ["read_file", "grep_codebase", "list_directory"],
};

function buildSystemPromptForRole(role: SubAgentType): string {
  const builder = new PromptBuilder();
  const allowed = new Set<string>(TOOLS_BY_TYPE[role]);
  const enabledTools = TOOL_CATALOG.map(toDynamicMetadata).filter((t) =>
    allowed.has(t.name),
  );
  const config: SubAgentConfig = {
    type: role,
    maxIterations: 5,
    userRequest: "<characterization-fixture>",
    modifiedFiles: [],
    recentToolResults: [],
  };
  return builder.buildForSubAgent(config, enabledTools, 131072);
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function readOrSeed(snapshotPath: string, actual: string): string {
  if (!fs.existsSync(snapshotPath)) {
    ensureDir(path.dirname(snapshotPath));
    fs.writeFileSync(snapshotPath, actual, "utf-8");
    return actual;
  }
  return fs.readFileSync(snapshotPath, "utf-8");
}

describe("SubAgentManager characterization (pre-refactor anchor)", () => {
  describe("system prompt snapshot per role", () => {
    for (const role of ["verification", "research", "planning"] as const) {
      it(`role '${role}' produces stable system prompt`, () => {
        const actual = buildSystemPromptForRole(role);
        const snapshotPath = path.join(SNAPSHOT_DIR, `${role}.txt`);
        const expected = readOrSeed(snapshotPath, actual);
        expect(actual).toBe(expected);
      });
    }
  });

  describe("tool-scope snapshot per role", () => {
    it("matches the locked tool-scope manifest", () => {
      const manifest = {
        verification: [...TOOLS_BY_TYPE.verification],
        research: [...TOOLS_BY_TYPE.research],
        planning: [...TOOLS_BY_TYPE.planning],
      };
      const snapshotPath = path.join(SNAPSHOT_DIR, "tool-scope.json");
      const serialized = JSON.stringify(manifest, null, 2) + "\n";
      const expected = readOrSeed(snapshotPath, serialized);
      expect(serialized).toBe(expected);
    });
  });

  describe("instruction strings (key phrases)", () => {
    it("verification instruction contains the no-create-no-delete rule", () => {
      const text = getSubAgentInstructions("verification");
      expect(text).toContain("Do not create or delete files");
    });

    it("research instruction contains the no-modify rule", () => {
      const text = getSubAgentInstructions("research");
      expect(text).toContain("Do not modify any files");
    });

    it("planning instruction contains the numbered-steps rule", () => {
      const text = getSubAgentInstructions("planning");
      expect(text).toContain("numbered implementation steps");
    });
  });

  describe("user-context message stays stable", () => {
    it("renders task / files / results sections as expected", () => {
      const msg = buildSubAgentContextMessage({
        type: "verification",
        maxIterations: 5,
        userRequest: "Verify the login change",
        modifiedFiles: ["src/auth.ts"],
        recentToolResults: ["[read_file] ok"],
        memoryContext: "Auth refactor last week.",
      });
      expect(msg).toContain("## Task\n\nVerify the login change");
      expect(msg).toContain("## Modified Files\n\n- src/auth.ts");
      expect(msg).toContain("## Recent Tool Results\n\n[read_file] ok");
      expect(msg).toContain("## Relevant Context\n\nAuth refactor last week.");
    });
  });
});
