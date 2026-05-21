import { describe, it, expect, vi, beforeEach } from "vitest";
import * as vscode from "vscode";
import { activateProxy } from "../../../src/activation/proxy.js";
import type { DaemonDiscoveryResult } from "../../../src/desktop/daemonDiscovery.js";

describe("activateProxy", () => {
  let context: { subscriptions: Array<{ dispose: () => void }> };
  let channel: { appendLine: ReturnType<typeof vi.fn> };

  const discovery: DaemonDiscoveryResult = {
    mode: "proxy",
    probedPath: "/tmp/nexus.test.sock",
    detected: true,
    reason: "Daemon socket present; the extension will proxy all calls.",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    context = { subscriptions: [] };
    channel = { appendLine: vi.fn() };
  });

  it("registers all six nexus.coding.* command ids", () => {
    activateProxy(
      context as unknown as vscode.ExtensionContext,
      channel as unknown as vscode.OutputChannel,
      discovery,
    );

    const registered = (
      vscode.commands.registerCommand as ReturnType<typeof vi.fn>
    ).mock.calls.map((call) => call[0] as string);

    for (const id of [
      "nexus.coding.ping",
      "nexus.coding.newChat",
      "nexus.coding.focusSidebar",
      "nexus.coding.openSession",
      "nexus.coding.detectGpu",
      "nexus.coding.hooks.editPlanModeHook",
    ]) {
      expect(registered).toContain(id);
    }
  });

  it("logs the daemon socket path on activation", () => {
    activateProxy(
      context as unknown as vscode.ExtensionContext,
      channel as unknown as vscode.OutputChannel,
      discovery,
    );

    const lines = channel.appendLine.mock.calls.map((c) => c[0] as string);
    expect(lines.some((l) => l.includes("/tmp/nexus.test.sock"))).toBe(true);
    expect(lines.some((l) => l.toLowerCase().includes("proxy mode"))).toBe(true);
  });

  it("creates a status bar item that points to the focus-sidebar command", () => {
    activateProxy(
      context as unknown as vscode.ExtensionContext,
      channel as unknown as vscode.OutputChannel,
      discovery,
    );

    const statusBarMock = vscode.window.createStatusBarItem as ReturnType<
      typeof vi.fn
    >;
    expect(statusBarMock).toHaveBeenCalled();
    // The proxy branch attaches the focus-sidebar command to the status bar
    // so a click surfaces the chat view.
    const lastReturn = statusBarMock.mock.results[statusBarMock.mock.results.length - 1]
      ?.value as { command?: string };
    expect(lastReturn.command).toBe("nexus.coding.focusSidebar");
  });

  it("appends every disposable to context.subscriptions", () => {
    activateProxy(
      context as unknown as vscode.ExtensionContext,
      channel as unknown as vscode.OutputChannel,
      discovery,
    );

    // 1 IPC client + 1 status bar item + 6 commands + 3 Phase 11 panels.
    expect(context.subscriptions.length).toBeGreaterThanOrEqual(11);
  });

  it("registers the three Phase 11 webview view providers (chat, memory, trace)", () => {
    activateProxy(
      context as unknown as vscode.ExtensionContext,
      channel as unknown as vscode.OutputChannel,
      discovery,
    );

    const providerCalls = (
      vscode.window.registerWebviewViewProvider as ReturnType<typeof vi.fn>
    ).mock.calls;
    const ids = providerCalls.map((c) => c[0] as string);
    expect(ids).toContain("nexus.coding.chatView");
    expect(ids).toContain("nexus.coding.memoryPanel");
    expect(ids).toContain("nexus.coding.traceDashboard");
  });

  it("logs the Phase 11 panel registration count", () => {
    activateProxy(
      context as unknown as vscode.ExtensionContext,
      channel as unknown as vscode.OutputChannel,
      discovery,
    );

    const lines = channel.appendLine.mock.calls.map((c) => c[0] as string);
    expect(lines.some((l) => l.includes("Phase 11 proxy panels registered"))).toBe(true);
  });
});
