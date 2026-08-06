/**
 * v1.15.0 Phase 7 (Issue 6) -- degraded ("safe mode") activation fallback.
 *
 * The reported failure was that clicking the Nexus icon reported
 * `command 'nexus.coding.newChat' not found` while the Chat / Memory / Traces
 * views span forever. Both symptoms had one cause: `activate()` threw before the
 * commands and webview providers were registered (the engine graph eagerly loads
 * the `better-sqlite3` native module, and an Electron ABI mismatch or a failing
 * subsystem constructor aborted activation part-way).
 *
 * This module guarantees a usable surface no matter what the engine does: every
 * declared command id and every declared view id gets a registration that
 * explains the degraded state instead of silently not existing. It only fills
 * gaps -- `registerFallbacks` skips ids that already registered successfully,
 * so a healthy activation is untouched.
 */

import * as vscode from "vscode";

/** Every command id declared in package.json's `contributes.commands`. */
export const DECLARED_COMMAND_IDS: ReadonlyArray<string> = Object.freeze([
  "nexus.coding.ping",
  "nexus.coding.newChat",
  "nexus.coding.focusSidebar",
  "nexus.coding.openSession",
  "nexus.coding.detectGpu",
  "nexus.coding.hooks.editPlanModeHook",
]);

/** Every webview view id declared in package.json's `contributes.views`. */
export const DECLARED_VIEW_IDS: ReadonlyArray<string> = Object.freeze([
  "nexus.coding.chatView",
  "nexus.coding.memoryPanel",
  "nexus.coding.traceDashboard",
]);

const SAFE_MODE_MESSAGE =
  "Nexus Code started in safe mode: the local engine failed to load, so chat, " +
  "memory, and traces are unavailable. See the 'Nexus Code' output channel for " +
  "the underlying error.";

function safeModeHtml(reason: string): string {
  const escaped = reason.replace(/[&<>]/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;",
  );
  return (
    '<!doctype html><html><body style="font-family:sans-serif;padding:12px;color:var(--vscode-foreground)">' +
    "<h3>Nexus Code -- safe mode</h3>" +
    "<p>The local engine failed to start, so this view is unavailable.</p>" +
    "<p>This usually means the native database module could not be loaded for this " +
    "version of VS Code. Reinstalling the extension from a build packaged with " +
    "<code>npm run package</code> normally fixes it.</p>" +
    `<pre style="white-space:pre-wrap;opacity:0.75;font-size:0.85em">${escaped}</pre>` +
    "</body></html>"
  );
}

class SafeModeViewProvider implements vscode.WebviewViewProvider {
  constructor(private readonly _reason: string) {}
  resolveWebviewView(webviewView: vscode.WebviewView): void {
    webviewView.webview.options = { enableScripts: false };
    webviewView.webview.html = safeModeHtml(this._reason);
  }
}

/**
 * Register a safe-mode handler for every declared command / view id that is not
 * already registered. Returns the ids it had to fill in (empty when activation
 * was healthy), so the caller can log precisely what degraded.
 */
export async function registerFallbacks(
  context: vscode.ExtensionContext,
  channel: vscode.OutputChannel,
  reason: string,
): Promise<{ commands: string[]; views: string[] }> {
  // Defensive: `getCommands` is the only way to know what already registered,
  // but never let its absence/failure break the safety net -- an empty set just
  // means we attempt every id and let the per-id catch handle duplicates.
  let existing = new Set<string>();
  try {
    existing = new Set(await vscode.commands.getCommands(true));
  } catch {
    existing = new Set<string>();
  }
  const filledCommands: string[] = [];

  for (const id of DECLARED_COMMAND_IDS) {
    if (existing.has(id)) continue;
    try {
      context.subscriptions.push(
        vscode.commands.registerCommand(id, () => {
          channel.show(true);
          void vscode.window.showWarningMessage(SAFE_MODE_MESSAGE);
        }),
      );
      filledCommands.push(id);
    } catch {
      // Another registration won the race -- the id exists, which is the goal.
    }
  }

  const filledViews: string[] = [];
  const provider = new SafeModeViewProvider(reason);
  for (const viewId of DECLARED_VIEW_IDS) {
    try {
      context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(viewId, provider),
      );
      filledViews.push(viewId);
    } catch {
      // Already registered by a healthy activation -- nothing to fill.
    }
  }

  return { commands: filledCommands, views: filledViews };
}
