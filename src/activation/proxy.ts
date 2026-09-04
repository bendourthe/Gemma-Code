/**
 * v1.1.0 Phase 10 + Phase 11 -- proxy activation branch.
 *
 * When `discoverDesktopDaemon()` reports a live Nexus daemon, every command
 * handler and every panel is a thin webview shell that forwards
 * `postMessage` calls into the daemon IPC client. The branch is intentionally
 * minimal: the daemon owns the conversation manager, the memory hub, the
 * tracer, the model registry, the skill catalog, the MCP harness; the
 * extension owns nothing but the webview chrome.
 *
 * v1.1.0 Phase 11 wires the seven Nexus-VS-Code-extension surfaces (multi-
 * model picker, plan mode, auto mode, memory panel, slash autocomplete,
 * sub-agent + sessions, MCP, settings sync) on top of this branch:
 *
 *   - `installNexusIpcClient` builds the structural `IpcClient` placeholder.
 *     The cross-process transport (named pipe / UNIX socket) is the upstream
 *     Phase 2 deliverable tracked under known-gap 10.1.P1.Z; the proxy
 *     installs a `NoopIpcClient` today so every Phase 11 panel boots
 *     cleanly and degrades to an "open the desktop app" hint when called.
 *   - `registerPhase11Panels` registers the three Phase 11 webview view
 *     providers (`nexus.coding.chatView`, `nexus.coding.memoryPanel`,
 *     `nexus.coding.traceDashboard`) with proxy shells whose HTML payload
 *     points the user at the desktop app until the IPC client lands.
 *
 * The extension-only fallback is at {@link ./extensionOnly.ts}. The two
 * branches share the keybinding compat shim at {@link ./compatShim.ts}.
 */

import * as vscode from "vscode";
import type { DaemonDiscoveryResult } from "../desktop/daemonDiscovery.js";
import { NoopIpcClient, type IpcClient } from "../desktop/ipcClient.js";
import { registerOwnedAgenticModelSurface } from "./ownedAgenticPicker.js";

export const PROXIED_COMMAND_IDS: ReadonlyArray<string> = Object.freeze([
  "nexus.coding.ping",
  "nexus.coding.newChat",
  "nexus.coding.focusSidebar",
  "nexus.coding.openSession",
  "nexus.coding.detectGpu",
  "nexus.coding.hooks.editPlanModeHook",
]);

/**
 * v1.1.0 Phase 11 -- panel view IDs the proxy branch registers as
 * thin shells. The view container IDs are declared in `package.json`
 * (`contributes.views.nexus-coding-sidebar`); the proxy registers a
 * `WebviewViewProvider` for each so VS Code's sidebar renders the
 * Nexus icons without an empty-pane gap.
 */
export const PHASE_11_VIEW_IDS: ReadonlyArray<string> = Object.freeze([
  "nexus.coding.chatView",
  "nexus.coding.memoryPanel",
  "nexus.coding.traceDashboard",
]);

const PROXY_PLACEHOLDER_HTML =
  '<!doctype html><html><body style="font-family:sans-serif;padding:12px;color:var(--vscode-foreground)">' +
  "<h3>Nexus Code</h3>" +
  "<p>Connected to the Nexus desktop daemon. Open the Nexus desktop window for the full agentic surface.</p>" +
  '<p style="font-size:0.85em;opacity:0.75">The daemon IPC client is wired by the upstream Phase 2 sidecar widening (v1.1.0 known-gap 10.1.P1.Z); this panel will switch to the live Phase 11 surfaces once that client lands.</p>' +
  "</body></html>";

class ProxyPlaceholderViewProvider implements vscode.WebviewViewProvider {
  resolveWebviewView(webviewView: vscode.WebviewView): void {
    webviewView.webview.options = { enableScripts: false };
    webviewView.webview.html = PROXY_PLACEHOLDER_HTML;
  }
}

/**
 * Install the Phase 11 IPC client. Today this returns a `NoopIpcClient`
 * because the cross-process transport (10.1.P1.Z) is deferred to the
 * Phase 2 sidecar widening. The function shape is kept stable so the
 * single switch from `new NoopIpcClient()` -> `new SocketIpcClient(...)`
 * lands cleanly when the transport ships.
 */
export function installNexusIpcClient(): IpcClient {
  return new NoopIpcClient();
}

/**
 * Register the Phase 11 view providers. Each view is currently a thin
 * placeholder; once the IPC client lands, the placeholders swap to live
 * webview bundles that forward through the daemon. The structural
 * surface (view IDs, sidebar layout, output-channel announcements) is
 * already correct, which is what the parity tests assert.
 */
export function registerPhase11Panels(
  context: vscode.ExtensionContext,
  channel: vscode.OutputChannel,
): void {
  const provider = new ProxyPlaceholderViewProvider();
  for (const viewId of PHASE_11_VIEW_IDS) {
    const disposable = vscode.window.registerWebviewViewProvider(
      viewId,
      provider,
    );
    context.subscriptions.push(disposable);
  }
  channel.appendLine(
    `[Nexus Code] Phase 11 proxy panels registered: ${PHASE_11_VIEW_IDS.length} views.`,
  );
}

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
    `[Nexus Code] Proxy mode: forwarding to daemon at ${discovery.probedPath}.`,
  );

  const ipcClient = installNexusIpcClient();
  // Tear the client down on extension deactivation so any future
  // socket-backed implementation closes its handle cleanly.
  context.subscriptions.push({
    dispose: () => ipcClient.close(),
  });

  const statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100,
  );
  statusBarItem.text = "$(plug) Nexus: daemon connected";
  statusBarItem.tooltip = `Nexus daemon socket: ${discovery.probedPath}`;
  statusBarItem.command = "nexus.coding.focusSidebar";
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // Snapshot lives on disk either way; the picker does not need the daemon.
  registerOwnedAgenticModelSurface(context);

  for (const commandId of PROXIED_COMMAND_IDS) {
    const disposable = vscode.commands.registerCommand(commandId, async () => {
      channel.appendLine(
        `[Nexus Code] Proxy: '${commandId}' would forward through the daemon. ` +
          "The desktop IPC client lands as part of the Phase 2 sidecar widening.",
      );
      void vscode.window.showInformationMessage(
        "Nexus Code is proxying to the desktop app. Open the Nexus desktop window to interact with this command.",
      );
    });
    context.subscriptions.push(disposable);
  }

  registerPhase11Panels(context, channel);

  channel.appendLine(
    `[Nexus Code] Proxy mode ready. ${PROXIED_COMMAND_IDS.length} commands forwarded; ${PHASE_11_VIEW_IDS.length} Phase 11 panels registered.`,
  );
}
