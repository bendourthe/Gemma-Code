import { describe, it, expect, vi, beforeEach } from "vitest";
import * as vscode from "vscode";
import {
  COMPAT_COMMAND_MAP,
  NEXUS_CODE_ALIAS_MAP,
  installCompatShim,
} from "../../../src/activation/compatShim.js";

describe("installCompatShim", () => {
  let context: { subscriptions: Array<{ dispose: () => void }> };
  let channel: { appendLine: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    context = { subscriptions: [] };
    channel = { appendLine: vi.fn() };
  });

  it("registers every legacy gemma-code.* command id", () => {
    installCompatShim(
      context as unknown as vscode.ExtensionContext,
      channel as unknown as vscode.OutputChannel,
    );

    const registered = (
      vscode.commands.registerCommand as ReturnType<typeof vi.fn>
    ).mock.calls.map((call) => call[0] as string);

    for (const [legacyId] of COMPAT_COMMAND_MAP) {
      expect(registered).toContain(legacyId);
    }
  });

  it("maps every legacy id to a nexus.coding.* replacement", () => {
    for (const [legacyId, newId] of COMPAT_COMMAND_MAP) {
      expect(legacyId.startsWith("gemma-code.")).toBe(true);
      expect(newId.startsWith("nexus.coding.")).toBe(true);
    }
  });

  it("emits exactly one deprecation line on the first invocation of a legacy id", () => {
    const execMock = vi.fn().mockResolvedValue(undefined);
    (vscode.commands as unknown as { executeCommand: typeof execMock }).executeCommand =
      execMock;

    installCompatShim(
      context as unknown as vscode.ExtensionContext,
      channel as unknown as vscode.OutputChannel,
    );

    const calls = (vscode.commands.registerCommand as ReturnType<typeof vi.fn>).mock
      .calls as ReadonlyArray<[string, (...args: unknown[]) => unknown]>;
    const pingHandler = calls.find(([id]) => id === "gemma-code.ping")?.[1];
    expect(pingHandler).toBeDefined();

    pingHandler!();
    pingHandler!();
    pingHandler!();

    const deprecationLines = channel.appendLine.mock.calls
      .map((c) => c[0] as string)
      .filter((line) => line.includes("[deprecation] gemma-code.ping"));
    expect(deprecationLines).toHaveLength(1);
    expect(deprecationLines[0]).toBe("[deprecation] gemma-code.ping -> nexus.coding.ping");

    expect(execMock).toHaveBeenCalledTimes(3);
    expect(execMock).toHaveBeenCalledWith("nexus.coding.ping");
  });

  it("tracks per-id once-per-session state so each legacy id logs independently", () => {
    const execMock = vi.fn().mockResolvedValue(undefined);
    (vscode.commands as unknown as { executeCommand: typeof execMock }).executeCommand =
      execMock;

    installCompatShim(
      context as unknown as vscode.ExtensionContext,
      channel as unknown as vscode.OutputChannel,
    );

    const calls = (vscode.commands.registerCommand as ReturnType<typeof vi.fn>).mock
      .calls as ReadonlyArray<[string, (...args: unknown[]) => unknown]>;
    const handlerFor = (id: string): (...a: unknown[]) => unknown => {
      const found = calls.find(([commandId]) => commandId === id)?.[1];
      if (!found) throw new Error(`handler for ${id} missing`);
      return found;
    };

    handlerFor("gemma-code.ping")();
    handlerFor("gemma-code.newChat")();
    handlerFor("gemma-code.ping")(); // duplicate; must not re-log

    const linesByLegacy = (id: string): number =>
      channel.appendLine.mock.calls.filter((c) =>
        (c[0] as string).startsWith(`[deprecation] ${id} `),
      ).length;

    expect(linesByLegacy("gemma-code.ping")).toBe(1);
    expect(linesByLegacy("gemma-code.newChat")).toBe(1);
  });

  it("appends every disposable to context.subscriptions", () => {
    installCompatShim(
      context as unknown as vscode.ExtensionContext,
      channel as unknown as vscode.OutputChannel,
    );

    // v1.15.0 Phase 7: the legacy gemma-code.* forwarders plus the new
    // nexus.code.* rename aliases.
    expect(context.subscriptions.length).toBe(
      COMPAT_COMMAND_MAP.length + NEXUS_CODE_ALIAS_MAP.length,
    );
  });

  it("registers a nexus.code.* alias for every canonical command (rename)", () => {
    installCompatShim(
      context as unknown as vscode.ExtensionContext,
      channel as unknown as vscode.OutputChannel,
    );

    const registered = (
      vscode.commands.registerCommand as ReturnType<typeof vi.fn>
    ).mock.calls.map((call: unknown[]) => call[0] as string);

    for (const [aliasId] of NEXUS_CODE_ALIAS_MAP) {
      expect(registered).toContain(aliasId);
    }
  });

  it("a nexus.code.* alias forwards to its nexus.coding.* canonical command", () => {
    const execMock = vi.fn().mockResolvedValue(undefined);
    (vscode.commands as unknown as { executeCommand: typeof execMock }).executeCommand =
      execMock;

    installCompatShim(
      context as unknown as vscode.ExtensionContext,
      channel as unknown as vscode.OutputChannel,
    );

    const calls = (vscode.commands.registerCommand as ReturnType<typeof vi.fn>).mock
      .calls as ReadonlyArray<[string, (...args: unknown[]) => unknown]>;
    const aliasHandler = calls.find(([id]) => id === "nexus.code.newChat")?.[1];
    expect(aliasHandler).toBeDefined();

    aliasHandler!();

    expect(execMock).toHaveBeenCalledWith("nexus.coding.newChat");
    // The new namespace is supported, not deprecated -- it must not log.
    const aliasLines = channel.appendLine.mock.calls.filter((c) =>
      (c[0] as string).includes("nexus.code."),
    );
    expect(aliasLines).toHaveLength(0);
  });

  it("forwards positional args to executeCommand", () => {
    const execMock = vi.fn().mockResolvedValue(undefined);
    (vscode.commands as unknown as { executeCommand: typeof execMock }).executeCommand =
      execMock;

    installCompatShim(
      context as unknown as vscode.ExtensionContext,
      channel as unknown as vscode.OutputChannel,
    );

    const calls = (vscode.commands.registerCommand as ReturnType<typeof vi.fn>).mock
      .calls as ReadonlyArray<[string, (...args: unknown[]) => unknown]>;
    const openSessionHandler = calls.find(
      ([id]) => id === "gemma-code.openSession",
    )?.[1];
    expect(openSessionHandler).toBeDefined();

    openSessionHandler!("session-id-42");

    expect(execMock).toHaveBeenCalledWith("nexus.coding.openSession", "session-id-42");
  });
});
