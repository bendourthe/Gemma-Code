/**
 * Integration: universal byte-cap applied through ToolRegistry.
 *
 * Asserts the cap fires on a stub handler whose output exceeds 64 KB and
 * that a per-call max_bytes override is honored end-to-end.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { ToolRegistry } from "../../src/tools/ToolRegistry.js";
import {
  DEFAULT_MAX_BYTES,
  TRUNCATION_MARKER,
  resetTruncationStats,
  getTruncationStats,
} from "../../src/tools/OutputRedirector.js";
import type { ToolHandler, ToolName, ToolResult } from "../../src/tools/types.js";

class FixedOutputHandler implements ToolHandler {
  constructor(private readonly _payload: string) {}
  async execute(parameters: Record<string, unknown>): Promise<ToolResult> {
    const id = (parameters["_callId"] as string | undefined) ?? "fixed";
    return { id, success: true, output: this._payload };
  }
}

beforeEach(() => {
  resetTruncationStats();
});

describe("ToolRegistry byte-cap end-to-end", () => {
  it("truncates a 200 KB tool output to ~64 KB by default", async () => {
    const registry = new ToolRegistry();
    const payload = "a".repeat(200 * 1024);
    registry.register("read_file" as ToolName, new FixedOutputHandler(payload));

    const result = await registry.execute({
      tool: "read_file" as ToolName,
      id: "call-1",
      parameters: {},
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain(TRUNCATION_MARKER);
    const stats = getTruncationStats();
    expect(stats.truncatedCount).toBe(1);
  });

  it("returns the full output when max_bytes raises the ceiling", async () => {
    const registry = new ToolRegistry();
    const payload = "b".repeat(100 * 1024); // 100 KB
    registry.register("read_file" as ToolName, new FixedOutputHandler(payload));

    const result = await registry.execute({
      tool: "read_file" as ToolName,
      id: "call-2",
      parameters: { max_bytes: 200 * 1024 },
    });

    expect(result.success).toBe(true);
    expect(result.output).not.toContain(TRUNCATION_MARKER);
    expect(result.output.length).toBe(100 * 1024);
  });

  it("rejects max_bytes above the per-call ceiling with an actionable error", async () => {
    const registry = new ToolRegistry();
    registry.register("read_file" as ToolName, new FixedOutputHandler("x"));

    const result = await registry.execute({
      tool: "read_file" as ToolName,
      id: "call-3",
      parameters: { max_bytes: 10 * 1024 * 1024 },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("max_bytes");
    expect(result.error).toContain("Usage:");
  });

  it("does not apply the cap to a small successful output", async () => {
    const registry = new ToolRegistry();
    registry.register("read_file" as ToolName, new FixedOutputHandler("hello"));

    const result = await registry.execute({
      tool: "read_file" as ToolName,
      id: "call-4",
      parameters: {},
    });

    expect(result.success).toBe(true);
    expect(result.output).toBe("hello");
    expect(result.output).not.toContain(TRUNCATION_MARKER);
  });

  it("honours DEFAULT_MAX_BYTES exactly when output equals the cap", async () => {
    const registry = new ToolRegistry();
    const payload = "c".repeat(DEFAULT_MAX_BYTES);
    registry.register("read_file" as ToolName, new FixedOutputHandler(payload));

    const result = await registry.execute({
      tool: "read_file" as ToolName,
      id: "call-5",
      parameters: {},
    });

    expect(result.success).toBe(true);
    expect(result.output).not.toContain(TRUNCATION_MARKER);
  });
});
