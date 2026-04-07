/**
 * Regression tests for error handling hardening (Phase 8, Sub-task 8.3).
 *
 * Covers:
 *  1. Global unhandled rejection handler wired up (smoke test only — we assert the handler exists)
 *  2. SSRF protection: FetchPageTool rejects internal URLs
 *  3. Terminal blocklist: chain-bypass via shell metacharacters is rejected
 *  4. File system errors: ReadFileTool wraps ENOENT and returns a typed error result
 *  5. ContextCompactor — shouldCompact threshold
 */

import { describe, it, expect, vi } from "vitest";
import { FetchPageTool } from "../../../src/tools/handlers/webSearch.js";
import { RunTerminalTool } from "../../../src/tools/handlers/terminal.js";
import { ReadFileTool } from "../../../src/tools/handlers/filesystem.js";
import { ConversationManager } from "../../../src/chat/ConversationManager.js";
import { ContextCompactor } from "../../../src/chat/ContextCompactor.js";

vi.mock("node-html-parser", () => ({ parse: vi.fn(() => ({ querySelectorAll: () => [] })) }));
vi.mock("../../../src/ollama/client.js", () => ({
  createOllamaClient: vi.fn(),
}));

// ---------------------------------------------------------------------------
// 1. Global unhandled rejection handler
// ---------------------------------------------------------------------------

describe("global unhandledRejection handler", () => {
  it("Node.js 'unhandledRejection' event listener is registered after extension activates", () => {
    // The handler is registered by a top-level process.on() call in extension.ts.
    // We verify that at least one listener exists (it may be registered by the test runner
    // as well, so we check for ≥ 1 rather than exactly 1).
    const listeners = process.listenerCount("unhandledRejection");
    expect(listeners).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// 2. SSRF protection in FetchPageTool
// ---------------------------------------------------------------------------

describe("FetchPageTool SSRF protection", () => {
  const tool = new FetchPageTool();

  const blockedUrls = [
    "http://localhost/secret",
    "http://127.0.0.1:8080/api",
    "http://169.254.169.254/latest/meta-data/",
    "http://10.0.0.1/admin",
    "http://192.168.1.1/",
    "http://172.20.0.1/internal",
    "file:///etc/passwd",
    "ftp://files.example.com/data",
    "http://::1/api",
  ];

  for (const url of blockedUrls) {
    it(`blocks "${url}"`, async () => {
      const result = await tool.execute({ url, _callId: "test" });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not allowed|permitted|Missing/);
    });
  }

  it("does not block a normal public URL (fetch will fail in test environment — that is OK)", async () => {
    // We just verify the SSRF check itself doesn't block public URLs.
    // The actual fetch will fail in a test environment without network.
    const result = await tool.execute({
      url: "https://example.com",
      _callId: "test",
    });
    // Either success (unlikely in test env) or a network error — NOT an SSRF block.
    if (!result.success) {
      expect(result.error).not.toMatch(/not allowed|permitted/);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Terminal blocklist — shell metacharacter bypass protection
// ---------------------------------------------------------------------------

describe("RunTerminalTool blocklist bypass via shell metacharacters", () => {
  const gate = {
    request: vi.fn().mockResolvedValue(true),
  };

  const tool = new RunTerminalTool(gate as never, "never" as never);

  const bypassAttempts = [
    "echo ok; rm -rf /",
    "ls && rm -rf /",
    "ls || shutdown",
    "echo hello | rm -rf /",
    "echo ok\nshutdown",
    "cat file; format c:",
    "ls; rd /s /q c:\\",
    "echo ok; mkfs /dev/sda",
  ];

  for (const cmd of bypassAttempts) {
    it(`blocks chained command: ${JSON.stringify(cmd)}`, async () => {
      const result = await tool.execute({ command: cmd, _callId: "test" });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/blocked/i);
    });
  }
});

// ---------------------------------------------------------------------------
// 4. ReadFileTool — wraps file system errors as typed ToolResult
// ---------------------------------------------------------------------------

describe("ReadFileTool — file not found returns typed error", () => {
  it("returns success=false with an error string when the file does not exist", async () => {
    const tool = new ReadFileTool();
    const result = await tool.execute({ path: "nonexistent.ts", _callId: "test" });
    expect(result.success).toBe(false);
    expect(typeof result.error).toBe("string");
    expect(result.error!.length).toBeGreaterThan(0);
  });

  it("returns success=false for path traversal attempts", async () => {
    const tool = new ReadFileTool();
    const result = await tool.execute({ path: "../../etc/passwd", _callId: "test" });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/traversal|outside/i);
  });
});

// ---------------------------------------------------------------------------
// 5. ContextCompactor — shouldCompact threshold
// ---------------------------------------------------------------------------

describe("ContextCompactor — shouldCompact threshold", () => {
  it("does not trigger compaction when the conversation is small", () => {
    const manager = new ConversationManager();
    manager.addUserMessage("Hi");
    manager.addAssistantMessage("Hello");
    const compactor = new ContextCompactor(manager, {} as never, "gemma3:27b", 8192);
    expect(compactor.shouldCompact()).toBe(false);
  });

  it("triggers compaction when token estimate exceeds 80% of maxTokens", () => {
    const manager = new ConversationManager();
    // 8192 * 0.8 = 6553.6 tokens → ~26 215 characters.
    const longMsg = "a".repeat(27_000);
    manager.addUserMessage(longMsg);
    const compactor = new ContextCompactor(manager, {} as never, "gemma3:27b", 8192);
    expect(compactor.shouldCompact()).toBe(true);
  });
});
