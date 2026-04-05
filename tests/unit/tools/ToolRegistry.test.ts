import { describe, it, expect, vi } from "vitest";
import { ToolRegistry } from "../../../src/tools/ToolRegistry.js";
import type { ToolCall, ToolHandler, ToolResult } from "../../../src/tools/types.js";

function makeCall(overrides: Partial<ToolCall> = {}): ToolCall {
  return { tool: "read_file", id: "call_001", parameters: {}, ...overrides };
}

function makeHandler(result: ToolResult): ToolHandler {
  return { execute: vi.fn().mockResolvedValue(result) };
}

describe("ToolRegistry", () => {
  it("executes a registered handler and returns its result", async () => {
    const registry = new ToolRegistry();
    const expected: ToolResult = { id: "call_001", success: true, output: "file content" };
    const handler = makeHandler(expected);

    registry.register("read_file", handler);
    const result = await registry.execute(makeCall());

    expect(result).toEqual(expected);
    expect(handler.execute).toHaveBeenCalledWith({});
  });

  it("returns failure result for an unregistered tool", async () => {
    const registry = new ToolRegistry();
    const result = await registry.execute(makeCall({ tool: "run_terminal" }));

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Unknown tool/);
  });

  it("wraps handler exceptions as a failure ToolResult", async () => {
    const registry = new ToolRegistry();
    const handler: ToolHandler = {
      execute: vi.fn().mockRejectedValue(new Error("disk full")),
    };

    registry.register("read_file", handler);
    const result = await registry.execute(makeCall());

    expect(result.success).toBe(false);
    expect(result.error).toBe("disk full");
  });

  it("wraps non-Error exceptions as a failure ToolResult", async () => {
    const registry = new ToolRegistry();
    const handler: ToolHandler = {
      execute: vi.fn().mockRejectedValue("something went wrong"),
    };

    registry.register("read_file", handler);
    const result = await registry.execute(makeCall());

    expect(result.success).toBe(false);
    expect(result.error).toBe("something went wrong");
  });

  it("has() returns false before registration and true after", () => {
    const registry = new ToolRegistry();
    expect(registry.has("read_file")).toBe(false);
    registry.register("read_file", makeHandler({ id: "x", success: true, output: "" }));
    expect(registry.has("read_file")).toBe(true);
  });

  it("passes call parameters to the handler", async () => {
    const registry = new ToolRegistry();
    const handler = makeHandler({ id: "x", success: true, output: "" });

    registry.register("read_file", handler);
    const params = { path: "src/extension.ts" };
    await registry.execute(makeCall({ parameters: params }));

    expect(handler.execute).toHaveBeenCalledWith(params);
  });

  it("overwriting a registration uses the new handler", async () => {
    const registry = new ToolRegistry();
    const first = makeHandler({ id: "x", success: true, output: "first" });
    const second = makeHandler({ id: "x", success: true, output: "second" });

    registry.register("read_file", first);
    registry.register("read_file", second);
    const result = await registry.execute(makeCall());

    expect(result.output).toBe("second");
    expect(first.execute).not.toHaveBeenCalled();
  });
});
