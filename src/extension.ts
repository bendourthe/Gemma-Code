/**
 * v1.1.0 Phase 10 -- VS Code extension thin-adapter entry point.
 *
 * The activator inspects whether the Nexus desktop daemon is reachable and
 * dispatches into one of two branches:
 *
 *   - {@link activateProxy} -- daemon detected; every command and panel is a
 *     thin webview shell that forwards through the daemon IPC client. The
 *     extension owns no in-process engine state.
 *   - {@link activateExtensionOnly} -- daemon absent; the legacy v0.X.0 /
 *     v1.0.0 in-process engine activation runs (kept for compatibility,
 *     targeted for removal in v1.2.0).
 *
 * Both branches share the legacy `gemma-code.<cmd>` keybinding compat shim
 * at {@link installCompatShim} so previously-bound user keybindings continue
 * to fire the renamed handlers and emit a single deprecation log per session.
 *
 * Discovery logic lives in {@link discoverDesktopDaemon}; the two activation
 * branches live in `./activation/*.ts`; this file orchestrates only.
 */

import * as vscode from "vscode";
import { discoverDesktopDaemon } from "./desktop/daemonDiscovery.js";
import { activateProxy } from "./activation/proxy.js";
import {
  activateExtensionOnly,
  stopOllamaPoller,
} from "./activation/extensionOnly.js";
import { installCompatShim } from "./activation/compatShim.js";
import { disposeEncoder as disposeTokenEncoder } from "../modules/coding/config/PromptBudget.js";

let outputChannel: vscode.OutputChannel | undefined;

process.on("unhandledRejection", (reason: unknown) => {
  const message =
    reason instanceof Error ? (reason.stack ?? reason.message) : String(reason);
  outputChannel?.appendLine(`[Nexus Coding] Unhandled promise rejection: ${message}`);
});

export function activate(context: vscode.ExtensionContext): void {
  outputChannel = vscode.window.createOutputChannel("Nexus Coding");
  context.subscriptions.push(outputChannel);

  const discovery = discoverDesktopDaemon();
  outputChannel.appendLine(
    `[Nexus Coding] Daemon discovery: mode=${discovery.mode}, path=${discovery.probedPath}. ` +
      discovery.reason,
  );

  if (discovery.mode === "proxy") {
    activateProxy(context, outputChannel, discovery);
  } else {
    activateExtensionOnly(context, outputChannel);
  }

  installCompatShim(context, outputChannel);
}

export async function deactivate(): Promise<void> {
  stopOllamaPoller();
  // Phase 5 (v0.5.0): release the cached tiktoken encoder so its native
  // handle is freed when the extension shuts down.
  disposeTokenEncoder();
}
