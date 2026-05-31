import { describe, it, expect } from "vitest";
import { classifyAction, ActionRisk } from "../../../modules/coding/guardrails/ActionClassifier.js";
import type { ToolCall } from "../../../src/tools/types.js";

function makeCall(tool: string, params: Record<string, unknown> = {}): ToolCall {
  return { tool: tool as ToolCall["tool"], id: "call_001", parameters: params };
}

describe("ActionClassifier", () => {
  describe("safe/reversible tools", () => {
    it("classifies read_file as REVERSIBLE", () => {
      const c = classifyAction(makeCall("read_file", { path: "a.ts" }));
      expect(c.risk).toBe(ActionRisk.REVERSIBLE);
      expect(c.requiresCheckpoint).toBe(false);
    });

    it("classifies list_directory as REVERSIBLE", () => {
      expect(classifyAction(makeCall("list_directory")).risk).toBe(ActionRisk.REVERSIBLE);
    });

    it("classifies grep_codebase as REVERSIBLE", () => {
      expect(classifyAction(makeCall("grep_codebase", { pattern: "TODO" })).risk).toBe(ActionRisk.REVERSIBLE);
    });

    it("classifies web_search as REVERSIBLE", () => {
      expect(classifyAction(makeCall("web_search", { query: "test" })).risk).toBe(ActionRisk.REVERSIBLE);
    });

    it("classifies fetch_page as REVERSIBLE", () => {
      expect(classifyAction(makeCall("fetch_page", { url: "https://example.com" })).risk).toBe(ActionRisk.REVERSIBLE);
    });
  });

  describe("file modification tools", () => {
    it("classifies write_file as DESTRUCTIVE", () => {
      const c = classifyAction(makeCall("write_file", { path: "a.ts", content: "x" }));
      expect(c.risk).toBe(ActionRisk.DESTRUCTIVE);
      expect(c.requiresCheckpoint).toBe(false);
    });

    it("classifies edit_file as DESTRUCTIVE", () => {
      expect(classifyAction(makeCall("edit_file")).risk).toBe(ActionRisk.DESTRUCTIVE);
    });

    it("classifies create_file as DESTRUCTIVE", () => {
      expect(classifyAction(makeCall("create_file")).risk).toBe(ActionRisk.DESTRUCTIVE);
    });

    it("classifies delete_file as DESTRUCTIVE with requiresCheckpoint", () => {
      const c = classifyAction(makeCall("delete_file", { path: "a.ts" }));
      expect(c.risk).toBe(ActionRisk.DESTRUCTIVE);
      expect(c.requiresCheckpoint).toBe(true);
      expect(c.enhancedConfirmation).toBe(true);
    });
  });

  describe("shell command analysis", () => {
    it("classifies read-only commands as REVERSIBLE", () => {
      expect(classifyAction(makeCall("run_terminal", { command: "ls -la" })).risk).toBe(ActionRisk.REVERSIBLE);
      expect(classifyAction(makeCall("run_terminal", { command: "git status" })).risk).toBe(ActionRisk.REVERSIBLE);
      expect(classifyAction(makeCall("run_terminal", { command: "cat file.txt" })).risk).toBe(ActionRisk.REVERSIBLE);
      expect(classifyAction(makeCall("run_terminal", { command: "echo hello" })).risk).toBe(ActionRisk.REVERSIBLE);
      expect(classifyAction(makeCall("run_terminal", { command: "pwd" })).risk).toBe(ActionRisk.REVERSIBLE);
      expect(classifyAction(makeCall("run_terminal", { command: "node --version" })).risk).toBe(ActionRisk.REVERSIBLE);
    });

    it("classifies BLOCKED_PATTERNS as BLOCKED", () => {
      const c = classifyAction(makeCall("run_terminal", { command: "rm -rf /" }));
      expect(c.risk).toBe(ActionRisk.BLOCKED);
    });

    it("classifies git push as DESTRUCTIVE with enhanced confirmation", () => {
      const c = classifyAction(makeCall("run_terminal", { command: "git push origin main" }));
      expect(c.risk).toBe(ActionRisk.DESTRUCTIVE);
      expect(c.enhancedConfirmation).toBe(true);
      expect(c.requiresCheckpoint).toBe(true);
    });

    it("classifies rm commands as DESTRUCTIVE", () => {
      const c = classifyAction(makeCall("run_terminal", { command: "rm file.txt" }));
      expect(c.risk).toBe(ActionRisk.DESTRUCTIVE);
      expect(c.enhancedConfirmation).toBe(true);
    });

    it("classifies npm publish as DESTRUCTIVE", () => {
      const c = classifyAction(makeCall("run_terminal", { command: "npm publish" }));
      expect(c.risk).toBe(ActionRisk.DESTRUCTIVE);
      expect(c.enhancedConfirmation).toBe(true);
    });

    it("defaults unrecognized commands to DESTRUCTIVE", () => {
      const c = classifyAction(makeCall("run_terminal", { command: "custom-build-tool --deploy" }));
      expect(c.risk).toBe(ActionRisk.DESTRUCTIVE);
      expect(c.enhancedConfirmation).toBe(false);
    });
  });

  describe("MCP tools", () => {
    it("defaults MCP tools to DESTRUCTIVE", () => {
      const c = classifyAction(makeCall("mcp:server/tool", { arg: "value" }));
      expect(c.risk).toBe(ActionRisk.DESTRUCTIVE);
    });
  });

  describe("unknown tools", () => {
    it("defaults unknown tools to DESTRUCTIVE", () => {
      const c = classifyAction(makeCall("some_future_tool"));
      expect(c.risk).toBe(ActionRisk.DESTRUCTIVE);
    });
  });
});
