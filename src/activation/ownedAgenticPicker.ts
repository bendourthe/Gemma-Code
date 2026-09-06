/**
 * v2.4.6 Phase 4 -- VS Code status-bar + command picker for owned agentic models.
 *
 * The enum is the AD-13 allowlist (installer ticks ∪ Settings downloads), not
 * `ollama list`. Empty owned set shows a Settings message. Registered from
 * both the extension-only and proxy activation branches so the palette entry
 * exists in every host.
 */

import * as vscode from "vscode";

import {
  EMPTY_OWNED_AGENTIC_MESSAGE,
  resolveCodingModelSelection,
  resolveOwnedAgenticId,
  type OwnedAgenticEntry,
} from "../../core/registry/ownedAgentic.js";
import { loadSelectionSnapshot } from "../../core/registry/ownedSelection.js";
import { getSettings } from "../../modules/coding/config/settings.js";
import { listOwnedAgenticModels } from "../../modules/coding/config/ownedAgenticFeed.js";

export const SELECT_MODEL_COMMAND = "nexus.coding.selectModel";

export interface OwnedAgenticPickerHost {
  readonly listOwned?: () => Promise<OwnedAgenticEntry[]>;
  readonly loadSnapshot?: () => ReturnType<typeof loadSelectionSnapshot>;
  readonly getCurrentModelName?: () => string;
  readonly updateModelName?: (id: string) => Thenable<void>;
}

function updateModelName(id: string): Thenable<void> {
  return vscode.workspace
    .getConfiguration("nexus.llm")
    .update("modelName", id, vscode.ConfigurationTarget.Global);
}

function statusText(label: string): string {
  return `$(symbol-misc) ${label}`;
}

export async function promptOwnedAgenticModel(
  entries: readonly OwnedAgenticEntry[],
  placeHolder?: string,
): Promise<string | undefined> {
  if (entries.length === 0) {
    void vscode.window.showInformationMessage(EMPTY_OWNED_AGENTIC_MESSAGE);
    return undefined;
  }
  const picked = await vscode.window.showQuickPick(
    entries.map((entry) => ({
      label: entry.displayName,
      description: entry.id,
    })),
    { placeHolder: placeHolder ?? "Select an owned agentic model" },
  );
  if (!picked) return undefined;
  const resolved = resolveOwnedAgenticId(picked.description, entries);
  if (!resolved.ok) {
    void vscode.window.showErrorMessage(resolved.message);
    return undefined;
  }
  return resolved.id;
}

export function registerOwnedAgenticModelSurface(
  context: vscode.ExtensionContext,
  host: OwnedAgenticPickerHost = {},
): { readonly ready: Promise<OwnedAgenticEntry[]> } {
  const statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    101,
  );
  statusBar.command = SELECT_MODEL_COMMAND;
  statusBar.tooltip = "Select an owned agentic model";
  statusBar.text = statusText("Model");
  statusBar.show();
  context.subscriptions.push(statusBar);

  const listOwned = host.listOwned ?? (() => listOwnedAgenticModels());
  const loadSnapshot = host.loadSnapshot ?? (() => loadSelectionSnapshot());
  const currentName =
    host.getCurrentModelName ?? (() => getSettings().modelName);
  const writeName = host.updateModelName ?? updateModelName;

  const refresh = async (): Promise<OwnedAgenticEntry[]> => {
    try {
      const entries = await listOwned();
      const snapshot = await loadSnapshot();
      const next = resolveCodingModelSelection(
        currentName(),
        entries,
        snapshot,
      );
      if (next.kind === "empty") {
        statusBar.text = statusText("No agentic model");
        return entries;
      }
      if (next.kind === "set") {
        await writeName(next.id);
      }
      statusBar.text = statusText(next.displayName);
      return entries;
    } catch {
      statusBar.text = statusText("No agentic model");
      return [];
    }
  };

  const command = vscode.commands.registerCommand(
    SELECT_MODEL_COMMAND,
    async () => {
      const entries = await listOwned();
      const selected = await promptOwnedAgenticModel(entries);
      if (!selected) return;
      await writeName(selected);
      const picked = entries.find((entry) => entry.id === selected);
      statusBar.text = statusText(picked?.displayName ?? selected);
    },
  );
  context.subscriptions.push(command);

  const ready = refresh();
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (
        event.affectsConfiguration("nexus.llm.modelName") ||
        event.affectsConfiguration("gemma-code.modelName")
      ) {
        void refresh();
      }
    }),
  );
  return { ready };
}
