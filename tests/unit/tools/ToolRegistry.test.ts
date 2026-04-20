import { describe, it, expect, vi } from "vitest";
import { ToolRegistry } from "../../../src/tools/ToolRegistry.js";
import type { ToolCall, ToolHandler, ToolResult } from "../../../src/tools/types.js";
import type { DynamicToolMetadata } from "../../../src/tools/ToolCatalog.js";
import type { ConfirmationGate } from "../../../src/tools/ConfirmationGate.js";
import { mockOf } from "../../helpers/factories.js";

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

  // ---- enable/disable --------------------------------------------------------

  it("newly registered tool is enabled by default", () => {
    const registry = new ToolRegistry();
    registry.register("read_file", makeHandler({ id: "x", success: true, output: "" }));
    expect(registry.isEnabled("read_file")).toBe(true);
  });

  it("setEnabled(false) causes execute() to return a disabled-tool error", async () => {
    const registry = new ToolRegistry();
    registry.register("read_file", makeHandler({ id: "x", success: true, output: "ok" }));
    registry.setEnabled("read_file", false);

    const result = await registry.execute(makeCall());
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/currently disabled/);
  });

  it("setEnabled(true) re-enables execution", async () => {
    const registry = new ToolRegistry();
    const handler = makeHandler({ id: "x", success: true, output: "ok" });
    registry.register("read_file", handler);
    registry.setEnabled("read_file", false);
    registry.setEnabled("read_file", true);

    const result = await registry.execute(makeCall());
    expect(result.success).toBe(true);
  });

  it("isEnabled() returns false for unregistered tools", () => {
    const registry = new ToolRegistry();
    expect(registry.isEnabled("read_file")).toBe(false);
  });

  it("getEnabledNames() returns only enabled tools", () => {
    const registry = new ToolRegistry();
    registry.register("read_file", makeHandler({ id: "x", success: true, output: "" }));
    registry.register("write_file", makeHandler({ id: "x", success: true, output: "" }));
    registry.register("edit_file", makeHandler({ id: "x", success: true, output: "" }));
    registry.setEnabled("write_file", false);

    const names = registry.getEnabledNames();
    expect(names).toContain("read_file");
    expect(names).toContain("edit_file");
    expect(names).not.toContain("write_file");
  });

  it("getEnabledToolMetadata() filters catalog to enabled tools", () => {
    const registry = new ToolRegistry();
    registry.register("read_file", makeHandler({ id: "x", success: true, output: "" }));
    registry.register("write_file", makeHandler({ id: "x", success: true, output: "" }));
    registry.setEnabled("write_file", false);

    const catalog: DynamicToolMetadata[] = [
      { name: "read_file", description: "Read", parameters: {}, source: "builtin", priority: 0 },
      { name: "write_file", description: "Write", parameters: {}, source: "builtin", priority: 0 },
    ];

    const enabled = registry.getEnabledToolMetadata(catalog);
    expect(enabled).toHaveLength(1);
    expect(enabled[0]!.name).toBe("read_file");
  });

  it("setEnabled() is a no-op for unregistered tools", () => {
    const registry = new ToolRegistry();
    registry.setEnabled("read_file", true);
    expect(registry.isEnabled("read_file")).toBe(false);
  });

  // ---- centralized confirmation deduplication --------------------------------

  describe("centralized confirmation gate", () => {
    function makeGate(approve: boolean = true) {
      const request = vi.fn().mockResolvedValue(approve);
      return {
        gate: mockOf<ConfirmationGate>({ request, requestDiffPreview: vi.fn(), resolve: vi.fn() }),
        request,
      };
    }

    it("fires the centralized gate exactly once for delete_file (no per-tool gate)", async () => {
      const registry = new ToolRegistry();
      registry.register("delete_file", makeHandler({ id: "x", success: true, output: "" }));
      const { gate, request } = makeGate(true);
      registry.setConfirmationGate(gate, undefined, "ask");

      await registry.execute(makeCall({ tool: "delete_file" }));
      expect(request).toHaveBeenCalledTimes(1);
    });

    it("skips the centralized gate for write_file when editMode is ask (per-tool fires its own)", async () => {
      const registry = new ToolRegistry();
      registry.register("write_file", makeHandler({ id: "x", success: true, output: "" }));
      const { gate, request } = makeGate(true);
      registry.setConfirmationGate(gate, undefined, "ask");

      await registry.execute(makeCall({ tool: "write_file" }));
      expect(request).not.toHaveBeenCalled();
    });

    it("skips the centralized gate for edit_file when editMode is plan", async () => {
      const registry = new ToolRegistry();
      registry.register("edit_file", makeHandler({ id: "x", success: true, output: "" }));
      const { gate, request } = makeGate(true);
      registry.setConfirmationGate(gate, undefined, "plan");

      await registry.execute(makeCall({ tool: "edit_file" }));
      expect(request).not.toHaveBeenCalled();
    });

    it("fires the centralized gate for create_file when editMode is auto", async () => {
      const registry = new ToolRegistry();
      registry.register("create_file", makeHandler({ id: "x", success: true, output: "" }));
      const { gate, request } = makeGate(true);
      registry.setConfirmationGate(gate, undefined, "auto");

      await registry.execute(makeCall({ tool: "create_file" }));
      expect(request).toHaveBeenCalledTimes(1);
    });

    it("returns rejection error when user denies the centralized gate", async () => {
      const registry = new ToolRegistry();
      const handler = makeHandler({ id: "x", success: true, output: "" });
      registry.register("run_terminal", handler);
      const { gate } = makeGate(false);
      registry.setConfirmationGate(gate, undefined, "auto");

      const result = await registry.execute(
        makeCall({ tool: "run_terminal", parameters: { command: "ls" } }),
      );
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/rejected by user/);
      expect(handler.execute).not.toHaveBeenCalled();
    });
  });
});
