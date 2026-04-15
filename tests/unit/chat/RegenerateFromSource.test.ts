import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { Message } from "../../../src/chat/types.js";

// Mock child_process before importing the module under test.
vi.mock("child_process", () => ({
  execSync: vi.fn(() => ""),
}));

import { execSync } from "child_process";
import { RegenerateFromSource } from "../../../src/chat/RegenerateFromSource.js";

const mockExecSync = vi.mocked(execSync);

let msgCounter = 0;

function msg(role: Message["role"], content: string): Message {
  msgCounter++;
  return {
    id: `msg-${msgCounter}`,
    role,
    content,
    timestamp: 1000 + msgCounter,
  };
}

describe("RegenerateFromSource", () => {
  let tmpDir: string;
  let strategy: RegenerateFromSource;

  beforeEach(() => {
    msgCounter = 0;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "regen-src-"));
    strategy = new RegenerateFromSource(tmpDir, 2000);
    mockExecSync.mockReset();
    mockExecSync.mockReturnValue("");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // _extractFilePaths
  // -------------------------------------------------------------------------

  describe("_extractFilePaths()", () => {
    it("finds .ts file paths in messages", () => {
      const messages = [msg("user", "I modified src/tools/ToolRegistry.ts")];
      const paths = strategy._extractFilePaths(messages);
      expect(paths).toContain("src/tools/ToolRegistry.ts");
    });

    it("finds multiple extensions", () => {
      const messages = [
        msg("assistant", "Check src/main.py and configs/settings.json"),
      ];
      const paths = strategy._extractFilePaths(messages);
      expect(paths).toContain("src/main.py");
      expect(paths).toContain("configs/settings.json");
    });

    it("deduplicates paths across messages", () => {
      const messages = [
        msg("user", "Read src/foo.ts"),
        msg("assistant", "Updated src/foo.ts"),
      ];
      const paths = strategy._extractFilePaths(messages);
      expect(paths.filter((p) => p === "src/foo.ts")).toHaveLength(1);
    });

    it("ignores non-path strings", () => {
      const messages = [msg("user", "The error says permission denied")];
      const paths = strategy._extractFilePaths(messages);
      expect(paths).toHaveLength(0);
    });

    it("handles paths in quotes", () => {
      const messages = [msg("user", 'Looking at "lib/utils/helpers.ts"')];
      const paths = strategy._extractFilePaths(messages);
      expect(paths).toContain("lib/utils/helpers.ts");
    });
  });

  // -------------------------------------------------------------------------
  // canApply
  // -------------------------------------------------------------------------

  describe("canApply()", () => {
    it("returns true when messages contain file paths", () => {
      const messages = [msg("user", "Modified src/chat/types.ts")];
      expect(strategy.canApply(messages, 5000)).toBe(true);
    });

    it("returns false when no file paths are present", () => {
      const messages = [msg("user", "Hello world")];
      expect(strategy.canApply(messages, 5000)).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // apply
  // -------------------------------------------------------------------------

  describe("apply()", () => {
    it("produces a regenerated summary with file sections", async () => {
      // Create a source file in the temp workspace.
      const srcDir = path.join(tmpDir, "src");
      fs.mkdirSync(srcDir, { recursive: true });
      fs.writeFileSync(
        path.join(srcDir, "example.ts"),
        "export function hello(): string {\n  return 'world';\n}\n",
        "utf-8",
      );

      mockExecSync.mockReturnValue("abc1234 initial commit\n");

      const messages = [
        msg("system", "System prompt"),
        msg("user", "Edit src/example.ts"),
        msg("assistant", "Done editing src/example.ts"),
      ];

      const result = await strategy.apply(messages, 5000);

      // Should preserve system message.
      expect(result[0]!.role).toBe("system");

      // Should have a regenerated summary message.
      const summary = result.find((m) =>
        m.content.includes("[Regenerated context from source]"),
      );
      expect(summary).toBeDefined();
      expect(summary!.content).toContain("Modified Files");
      expect(summary!.content).toContain("src/example.ts");
      expect(summary!.content).toContain("export function hello");
    });

    it("falls through gracefully when files do not exist", async () => {
      const messages = [
        msg("system", "System prompt"),
        msg("user", "Edit src/nonexistent.ts"),
      ];

      const result = await strategy.apply(messages, 5000);
      expect(result.length).toBeGreaterThan(0);
      // Summary should still be generated (just without file snippets).
      const summary = result.find((m) =>
        m.content.includes("[Regenerated context from source]"),
      );
      expect(summary).toBeDefined();
    });

    it("falls through gracefully when git commands fail", async () => {
      mockExecSync.mockImplementation(() => {
        throw new Error("not a git repository");
      });

      const messages = [
        msg("system", "System prompt"),
        msg("user", "Edit src/some.ts"),
      ];

      const result = await strategy.apply(messages, 5000);
      const summary = result.find((m) =>
        m.content.includes("[Regenerated context from source]"),
      );
      expect(summary).toBeDefined();
      // No git section should appear.
      expect(summary!.content).not.toContain("Recent Git Activity");
    });

    it("preserves system messages and recent messages", async () => {
      const messages = [
        msg("system", "System prompt"),
        msg("user", "msg 1 about src/a.ts"),
        msg("assistant", "reply 1"),
        msg("user", "msg 2"),
        msg("assistant", "reply 2"),
      ];

      const result = await strategy.apply(messages, 5000);
      // System message is preserved.
      expect(result[0]!.role).toBe("system");
      expect(result[0]!.content).toBe("System prompt");
      // Last recent messages are kept.
      expect(result[result.length - 1]!.content).toBe("reply 2");
    });

    it("respects maxSummaryTokens budget", async () => {
      // Create a large source file.
      const srcDir = path.join(tmpDir, "src");
      fs.mkdirSync(srcDir, { recursive: true });
      const bigContent = "x".repeat(50000);
      fs.writeFileSync(path.join(srcDir, "big.ts"), bigContent, "utf-8");

      const tinyStrategy = new RegenerateFromSource(tmpDir, 50);
      const messages = [
        msg("system", "System"),
        msg("user", "Check src/big.ts"),
      ];

      const result = await tinyStrategy.apply(messages, 1000);
      const summary = result.find((m) =>
        m.content.includes("[Regenerated context from source]"),
      );
      expect(summary).toBeDefined();
      // 50 tokens * 4 chars = 200 chars max, plus truncation marker.
      expect(summary!.content.length).toBeLessThan(400);
    });
  });

  // -------------------------------------------------------------------------
  // _extractDecisions
  // -------------------------------------------------------------------------

  describe("_extractDecisions()", () => {
    it("finds decision-like sentences", () => {
      const messages = [
        msg("assistant", "We decided to use SQLite because it is embedded."),
        msg("user", "Sounds good"),
      ];
      const decisions = strategy._extractDecisions(messages);
      expect(decisions.length).toBeGreaterThan(0);
      expect(decisions[0]).toContain("decided");
    });

    it("skips system messages", () => {
      const messages = [
        msg("system", "We decided to use a special system. Because reasons."),
      ];
      const decisions = strategy._extractDecisions(messages);
      expect(decisions).toHaveLength(0);
    });

    it("caps at 10 decisions", () => {
      const messages = Array.from({ length: 20 }, (_, i) =>
        msg("assistant", `We decided to do thing ${i} because it matters.`),
      );
      const decisions = strategy._extractDecisions(messages);
      expect(decisions.length).toBeLessThanOrEqual(10);
    });
  });
});
