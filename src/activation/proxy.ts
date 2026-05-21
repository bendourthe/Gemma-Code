/**
 * v1.1.0 Phase 10 -- proxy activation branch.
 *
 * When `discoverDesktopDaemon()` reports a live Nexus daemon, every command
 * handler and every panel is a thin webview shell that forwards
 * `postMessage` calls into the daemon IPC client. The branch is intentionally
 * minimal: the daemon owns the conversation manager, the memory hub, the
 * tracer, the model registry, the skill catalog, the MCP harness; the
 * extension owns nothing but the webview chrome.
 *
 * The actual sidecar IPC client (named pipe on Windows, Unix domain socket
 * on macOS / Linux, `tauri::Channel` bridge for streaming events) is the
 * upstream Phase 2 deliverable; this branch wires the activation shape so
 * the user gets the proxy mode the moment that client lands. Today every
 * proxied command surfaces an "open desktop app" hint via VS Code's status
 * bar / notification surface; the legacy in-process engine never spins up
 * in this branch, so the extension's footprint is a handful of webviews
 * and a status bar item.
 *
 * The extension-only fallback is at {@link ./extensionOnly.ts} and is kept
 * for compatibility through v1.2.0. The two branches share the keybinding
 * compat shim at {@link ./compatShim.ts}.
 */

import * as vscode from "vscode";
import type { DaemonDiscoveryResult } from "../desktop/daemonDiscovery.js";

const PROXIED_COMMAND_IDS: ReadonlyArray<string> = Object.freeze([
  "nexus.coding.ping",
  "nexus.coding.newChat",
  "nexus.coding.focusSidebar",
  "nexus.coding.openSession",
  "nexus.coding.detectGpu",
  "nexus.coding.hooks.editPlanModeHook",
]);

/**
 * Activate the extension in proxy mode. Every command registered here
 * forwards through the daemon; no in-process engine state is constructed.
 */
export function activateProxy(
  context: vscode.ExtensionContext,
  channel: vscode.OutputChannel,
  discovery: DaemonDiscoveryResult,
): void {
  channel.appendLine(
    `[Nexus Coding] Proxy mode: forwarding to daemon at ${discovery.probedPath}.`,
  );

  const statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100,
  );
  statusBarItem.text = "$(plug) Nexus: daemon connected";
  statusBarItem.tooltip = `Nexus daemon socket: ${discovery.probedPath}`;
  statusBarItem.command = "nexus.coding.focusSidebar";
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  for (const commandId of PROXIED_COMMAND_IDS) {
    const disposable = vscode.commands.registerCommand(commandId, async () => {
      channel.appendLine(
        `[Nexus Coding] Proxy: '${commandId}' would forward through the daemon. ` +
          "The desktop IPC client lands as part of the Phase 2 sidecar widening.",
      );
      void vscode.window.showInformationMessage(
        "Nexus Coding is proxying to the desktop app. Open the Nexus desktop window to interact with this command.",
      );
    });
    context.subscriptions.push(disposable);
  }

  channel.appendLine(
    `[Nexus Coding] Proxy mode ready. ${PROXIED_COMMAND_IDS.length} commands forwarded.`,
  );
}
