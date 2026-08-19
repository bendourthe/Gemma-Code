import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { createHash } from "crypto";
import { WatchPathTool, HashFileTool } from "../../../../src/tools/handlers/observe.js";
import { MOCK_WORKSPACE_ROOT } from "../../../setup.js";

function params(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { _callId: "call_001", ...overrides };
}

describe("watch_path / hash_file", () => {
  it("watch_path rejects a missing path", async () => {
    const tool = new WatchPathTool();
    const result = await tool.execute(params());
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/path/i);
  });

  it("watch_path rejects a path outside the workspace", async () => {
    const tool = new WatchPathTool();
    const result = await tool.execute(params({ path: "../../etc/passwd", timeout_ms: 50 }));
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/outside the workspace/i);
  });

  it("watch_path returns a bounded result for an in-workspace path", async () => {
    const result = await new WatchPathTool().execute(params({ path: "src", timeout_ms: 50 }));
    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output) as { timeout_ms: number; events: unknown[] };
    expect(parsed.timeout_ms).toBe(50);
    expect(Array.isArray(parsed.events)).toBe(true);
  });

  it("hash_file rejects a missing path", async () => {
    const result = await new HashFileTool().execute(params());
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/path/i);
  });

  it("hash_file rejects a path outside the workspace", async () => {
    const tool = new HashFileTool();
    const result = await tool.execute(params({ path: "../../etc/passwd" }));
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/outside the workspace/i);
  });

  it("hash_file fails for a missing in-workspace file", async () => {
    const tool = new HashFileTool();
    const result = await tool.execute(params({ path: "src/does-not-exist-v1191.bin" }));
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/existing|unreadable|not found|Failed to read/i);
  });

  it("hash_file returns sha256 for an in-workspace file", async () => {
    const rel = path.join("src", "hello-v1191.txt");
    const abs = path.join(MOCK_WORKSPACE_ROOT, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, "hello");
    try {
      const result = await new HashFileTool().execute(params({ path: rel.replace(/\\/g, "/") }));
      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.output) as { algorithm: string; hash: string; bytes: number };
      expect(parsed.algorithm).toBe("sha256");
      expect(parsed.hash).toBe(createHash("sha256").update("hello").digest("hex"));
      expect(parsed.bytes).toBe(5);
    } finally {
      fs.rmSync(abs, { force: true });
    }
  });
});
