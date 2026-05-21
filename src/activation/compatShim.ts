/**
 * v1.1.0 Phase 10 -- legacy `gemma-code.<cmd>` keybinding compat shim.
 *
 * The shim is registered programmatically (not via `contributes.commands` in
 * the manifest) so the legacy IDs do not surface in the Command Palette but
 * previously-bound user keybindings continue to fire the renamed handlers.
 * Each legacy ID emits a single deprecation line to the output channel
 * **exactly once per session**, regardless of how many times the user
 * triggers the keybinding. Subsequent invocations forward silently. The
 * shim is targeted for removal in v1.2.0 once user keybindings have had a
 * release cycle to migrate.
 *
 * The shim is shared between the proxy and extension-only activation
 * branches so a user who installs the extension on a host with the desktop
 * daemon running sees the same keybinding behaviour as a host without it.
 */

import * as vscode from "vscode";

export const COMPAT_COMMAND_MAP: ReadonlyArray<readonly [string, string]> = Object.freeze([
  ["gemma-code.ping", "nexus.coding.ping"],
  ["gemma-code.newChat", "nexus.coding.newChat"],
  ["gemma-code.focusSidebar", "nexus.coding.focusSidebar"],
  ["gemma-code.openSession", "nexus.coding.openSession"],
  ["gemma-code.detectGpu", "nexus.coding.detectGpu"],
  ["gemma-code.hooks.editPlanModeHook", "nexus.coding.hooks.editPlanModeHook"],
] as const);

/**
 * Register the legacy `gemma-code.<cmd>` IDs as thin forwarders to their
 * `nexus.coding.<cmd>` replacements. The first invocation of each legacy ID
 * in a session writes a single deprecation line to {@link channel}; later
 * invocations forward silently. Disposables are appended to
 * `context.subscriptions` so VS Code unregisters them on deactivate.
 *
 * @param context VS Code extension context for disposable lifetime.
 * @param channel Output channel that receives the deprecation log.
 */
export function installCompatShim(
  context: vscode.ExtensionContext,
  channel: vscode.OutputChannel,
): void {
  const logged = new Set<string>();
  for (const [legacyId, newId] of COMPAT_COMMAND_MAP) {
    const disposable = vscode.commands.registerCommand(legacyId, (...args: unknown[]) => {
      if (!logged.has(legacyId)) {
        logged.add(legacyId);
        channel.appendLine(`[deprecation] ${legacyId} -> ${newId}`);
      }
      return vscode.commands.executeCommand(newId, ...args);
    });
    context.subscriptions.push(disposable);
  }
}
