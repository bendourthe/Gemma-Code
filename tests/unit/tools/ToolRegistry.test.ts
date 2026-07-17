import { describe, it, expect, vi } from "vitest";
import { ToolRegistry } from "../../../src/tools/ToolRegistry.js";
import type { ToolCall, ToolHandler, ToolResult } from "../../../src/tools/types.js";
import type { DynamicToolMetadata } from "../../../src/tools/ToolCatalog.js";
import type { ConfirmationGate } from "../../../src/tools/ConfirmationGate.js";
import { parsePermissionsDeny } from "../../../core/storage/PermissionsDeny.js";
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

    it("applies permissionOverrides so an auto-approve tool can be elevated to dangerous", async () => {
      const registry = new ToolRegistry();
      registry.register("read_file", makeHandler({ id: "x", success: true, output: "" }));
      const { gate, request } = makeGate(true);
      registry.setConfirmationGate(gate, { read_file: 2 }, "auto");

      await registry.execute(makeCall({ tool: "read_file", parameters: { path: "x.txt" } }));
      expect(request).toHaveBeenCalledTimes(1);
    });
  });

  describe("run_terminal built-in secret-path gate (H3)", () => {
    function makeGate(approve = true) {
      const request = vi.fn().mockResolvedValue(approve);
      return {
        gate: mockOf<ConfirmationGate>({ request, requestDiffPreview: vi.fn(), resolve: vi.fn() }),
        request,
      };
    }

    // Redirection writes are enumerated in both the bash and cmd dialects, so
    // these assert the same way regardless of the host shell.
    it("refuses a command that writes a secret path, before the confirmation gate", async () => {
      const registry = new ToolRegistry();
      const handler = makeHandler({ id: "x", success: true, output: "" });
      registry.register("run_terminal", handler);

      const result = await registry.execute(
        makeCall({ tool: "run_terminal", parameters: { command: "echo secret > .env" } }),
      );
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/secret path/i);
      expect(handler.execute).not.toHaveBeenCalled();
    });

    it("allows a command that touches only non-secret paths (reaches the handler)", async () => {
      const registry = new ToolRegistry();
      const handler = makeHandler({ id: "x", success: true, output: "" });
      registry.register("run_terminal", handler);
      const { gate } = makeGate(true);
      registry.setConfirmationGate(gate, undefined, "auto");

      const result = await registry.execute(
        makeCall({ tool: "run_terminal", parameters: { command: "echo out > build-output.txt" } }),
      );
      expect(result.success).toBe(true);
      expect(handler.execute).toHaveBeenCalledTimes(1);
    });

    it("is fail-closed: a dynamic command is not secret-path-blocked (falls through to the gate)", async () => {
      const registry = new ToolRegistry();
      const handler = makeHandler({ id: "x", success: true, output: "" });
      registry.register("run_terminal", handler);
      const { gate } = makeGate(true);
      registry.setConfirmationGate(gate, undefined, "auto");

      const result = await registry.execute(
        makeCall({ tool: "run_terminal", parameters: { command: "echo x > $(echo .env)" } }),
      );
      // The secret-path gate does not fire on an unparseable command; the
      // DANGEROUS-tier confirmation is the fallback (approved here).
      expect(result.error ?? "").not.toMatch(/secret path/i);
      expect(handler.execute).toHaveBeenCalledTimes(1);
    });

    it("honors operator extra secret-path patterns via setSecretPathDenyExtra", async () => {
      const registry = new ToolRegistry();
      const handler = makeHandler({ id: "x", success: true, output: "" });
      registry.register("run_terminal", handler);
      registry.setSecretPathDenyExtra(["**/custom-secret.txt"]);

      const result = await registry.execute(
        makeCall({ tool: "run_terminal", parameters: { command: "echo x > custom-secret.txt" } }),
      );
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/secret path/i);
      expect(handler.execute).not.toHaveBeenCalled();
    });
  });

  describe("lazy registration (Phase 6.6)", () => {
    it("reports has() / isEnabled() true for a lazy-registered tool before first use", () => {
      const registry = new ToolRegistry();
      registry.registerLazy("run_terminal", () =>
        makeHandler({ id: "x", success: true, output: "" }),
      );
      expect(registry.has("run_terminal")).toBe(true);
      expect(registry.isEnabled("run_terminal")).toBe(true);
      expect(registry.getEnabledNames()).toContain("run_terminal");
    });

    it("resolves the factory once and caches the handler", async () => {
      const factory = vi.fn(() =>
        makeHandler({ id: "x", success: true, output: "out" }),
      );
      const registry = new ToolRegistry();
      registry.registerLazy("run_terminal", factory);

      await registry.execute(makeCall({ tool: "run_terminal", parameters: {} }));
      await registry.execute(makeCall({ tool: "run_terminal", parameters: {} }));
      await registry.execute(makeCall({ tool: "run_terminal", parameters: {} }));

      expect(factory).toHaveBeenCalledTimes(1);
    });

    it("resolveLazy returns the same handler on repeated calls", async () => {
      const handler = makeHandler({ id: "x", success: true, output: "" });
      const registry = new ToolRegistry();
      registry.registerLazy("run_terminal", () => handler);

      const a = await registry.resolveLazy("run_terminal");
      const b = await registry.resolveLazy("run_terminal");
      expect(a).toBe(handler);
      expect(b).toBe(handler);
    });

    it("resolveLazy returns undefined for an unknown tool", async () => {
      const registry = new ToolRegistry();
      const result = await registry.resolveLazy("run_terminal");
      expect(result).toBeUndefined();
    });

    it("supports async factories that import a module", async () => {
      const handler = makeHandler({ id: "x", success: true, output: "imported" });
      const registry = new ToolRegistry();
      registry.registerLazy("run_terminal", async () => {
        // Simulate dynamic import: await a microtask.
        await Promise.resolve();
        return handler;
      });

      const result = await registry.execute(makeCall({ tool: "run_terminal" }));
      expect(result.output).toBe("imported");
    });

    it("eager register() overrides a prior lazy registration", async () => {
      const lazyFactory = vi.fn(() =>
        makeHandler({ id: "x", success: true, output: "lazy" }),
      );
      const eagerHandler = makeHandler({ id: "x", success: true, output: "eager" });
      const registry = new ToolRegistry();
      registry.registerLazy("run_terminal", lazyFactory);
      registry.register("run_terminal", eagerHandler);

      const result = await registry.execute(makeCall({ tool: "run_terminal" }));
      expect(result.output).toBe("eager");
      expect(lazyFactory).not.toHaveBeenCalled();
    });
  });

  // v1.4.0 Phase 8 (gap 5.3.P2.R): the operator `.nexus/permissions.deny` gate.
  describe("permissions deny gate", () => {
    it("refuses a run_terminal call whose command matches a deny rule", async () => {
      const registry = new ToolRegistry();
      const handler = makeHandler({ id: "call_001", success: true, output: "ran" });
      registry.register("run_terminal", handler);
      registry.setPermissionsDeny(parsePermissionsDeny("run_terminal: git push *"));

      const result = await registry.execute(
        makeCall({ tool: "run_terminal", parameters: { command: "git push origin main" } }),
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/denied by \.nexus\/permissions\.deny/);
      expect(result.error).toMatch(/run_terminal: git push \*/);
      expect(handler.execute).not.toHaveBeenCalled();
    });

    it("allows a run_terminal call that does not match any deny rule", async () => {
      const registry = new ToolRegistry();
      const handler = makeHandler({ id: "call_001", success: true, output: "ran" });
      registry.register("run_terminal", handler);
      registry.setPermissionsDeny(parsePermissionsDeny("run_terminal: git push *"));

      const result = await registry.execute(
        makeCall({ tool: "run_terminal", parameters: { command: "git status" } }),
      );

      expect(result.success).toBe(true);
      expect(handler.execute).toHaveBeenCalledOnce();
    });

    it("matches the path subject for write-capable file tools", async () => {
      const registry = new ToolRegistry();
      const handler = makeHandler({ id: "call_001", success: true, output: "wrote" });
      registry.register("write_file", handler);
      registry.setPermissionsDeny(parsePermissionsDeny("write_file: docs/archive/**"));

      const denied = await registry.execute(
        makeCall({ tool: "write_file", parameters: { path: "docs/archive/old.md", content: "x" } }),
      );
      expect(denied.success).toBe(false);
      expect(handler.execute).not.toHaveBeenCalled();

      const allowed = await registry.execute(
        makeCall({ tool: "write_file", parameters: { path: "src/index.ts", content: "x" } }),
      );
      expect(allowed.success).toBe(true);
    });

    it("never gates a read-only tool and is a no-op without a denylist", async () => {
      const registry = new ToolRegistry();
      const handler = makeHandler({ id: "call_001", success: true, output: "content" });
      registry.register("read_file", handler);
      // A blanket `*` rule still must not touch read_file (no deny subject param).
      registry.setPermissionsDeny(parsePermissionsDeny("*: anything"));

      const result = await registry.execute(
        makeCall({ tool: "read_file", parameters: { path: "anything" } }),
      );
      expect(result.success).toBe(true);
      expect(handler.execute).toHaveBeenCalledOnce();
    });
  });

  // v1.7.0 Phase 5 (O-A): shell-command introspection extends the deny gate so a
  // `run_terminal` command's *touched paths* are matched against file-tool deny
  // rules -- not just the command string. Redirection-based commands are used so
  // the test is deterministic across the platform-derived shell dialect.
  describe("shell-command introspection deny gate (O-A)", () => {
    it("blocks a run_terminal command whose write target matches a write_file rule", async () => {
      const registry = new ToolRegistry();
      const handler = makeHandler({ id: "call_001", success: true, output: "ran" });
      registry.register("run_terminal", handler);
      registry.setPermissionsDeny(parsePermissionsDeny("write_file: secrets/**"));

      const result = await registry.execute(
        makeCall({
          tool: "run_terminal",
          parameters: { command: "echo leaked > secrets/prod.env" },
        }),
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/touches path "secrets\/prod\.env" \(write\)/);
      expect(result.error).toMatch(/denied by \.nexus\/permissions\.deny/);
      expect(handler.execute).not.toHaveBeenCalled();
    });

    it("blocks a touched write path via a blanket * rule", async () => {
      const registry = new ToolRegistry();
      const handler = makeHandler({ id: "call_001", success: true, output: "ran" });
      registry.register("run_terminal", handler);
      registry.setPermissionsDeny(parsePermissionsDeny("*: secrets/**"));

      const result = await registry.execute(
        makeCall({
          tool: "run_terminal",
          parameters: { command: "echo x >> secrets/notes.txt" },
        }),
      );

      expect(result.success).toBe(false);
      expect(handler.execute).not.toHaveBeenCalled();
    });

    it("allows a run_terminal command whose touched paths are not denied", async () => {
      const registry = new ToolRegistry();
      const handler = makeHandler({ id: "call_001", success: true, output: "ran" });
      registry.register("run_terminal", handler);
      registry.setPermissionsDeny(parsePermissionsDeny("write_file: secrets/**"));

      const result = await registry.execute(
        makeCall({
          tool: "run_terminal",
          parameters: { command: "echo build info > build/info.txt" },
        }),
      );

      expect(result.success).toBe(true);
      expect(handler.execute).toHaveBeenCalledOnce();
    });

    it("fails closed on an un-parseable command: no fabricated path block", async () => {
      // An unbalanced quote makes the command un-parseable in every dialect, so
      // path-gating declines (it cannot prove the command touches secrets/**).
      // The DANGEROUS-tier confirmation still gates it in production; here, with
      // no confirmation gate and no command-string rule, the handler runs -- the
      // introspection never fabricates a verdict it cannot substantiate.
      const registry = new ToolRegistry();
      const handler = makeHandler({ id: "call_001", success: true, output: "ran" });
      registry.register("run_terminal", handler);
      registry.setPermissionsDeny(parsePermissionsDeny("write_file: secrets/**"));

      const result = await registry.execute(
        makeCall({
          tool: "run_terminal",
          parameters: { command: 'echo "leak > secrets/prod.env' },
        }),
      );

      expect(result.success).toBe(true);
      expect(handler.execute).toHaveBeenCalledOnce();
    });

    it("does not loosen the existing command-string deny gate on fallback", async () => {
      // Even when introspection cannot parse the command, the command-string
      // deny rule still fires first -- the fallback never bypasses it.
      const registry = new ToolRegistry();
      const handler = makeHandler({ id: "call_001", success: true, output: "ran" });
      registry.register("run_terminal", handler);
      registry.setPermissionsDeny(parsePermissionsDeny("run_terminal: echo *"));

      const result = await registry.execute(
        makeCall({
          tool: "run_terminal",
          parameters: { command: 'echo "unterminated' },
        }),
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/denied by \.nexus\/permissions\.deny/);
      expect(handler.execute).not.toHaveBeenCalled();
    });
  });
});
