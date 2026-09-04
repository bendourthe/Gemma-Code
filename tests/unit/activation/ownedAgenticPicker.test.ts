/**
 * v2.4.6 Phase 4 -- VS Code owned-agentic picker surface.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import {
  promptOwnedAgenticModel,
  registerOwnedAgenticModelSurface,
  SELECT_MODEL_COMMAND,
} from "../../../src/activation/ownedAgenticPicker.js";
import { EMPTY_OWNED_AGENTIC_MESSAGE } from "../../../core/registry/ownedAgentic.js";
import { DECLARED_COMMAND_IDS } from "../../../src/activation/safeMode.js";
import { PROXIED_COMMAND_IDS } from "../../../src/activation/proxy.js";
import { triggerConfigurationChange } from "../../setup.js";

function makeContext(): vscode.ExtensionContext {
  return {
    subscriptions: [],
  } as unknown as vscode.ExtensionContext;
}

describe("owned agentic picker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("declares nexus.coding.selectModel for safe-mode fallback", () => {
    expect(DECLARED_COMMAND_IDS).toContain(SELECT_MODEL_COMMAND);
  });

  it("does not proxy selectModel through the desktop placeholder", () => {
    expect(PROXIED_COMMAND_IDS).not.toContain(SELECT_MODEL_COMMAND);
  });

  it("registers the command and a status-bar item", () => {
    const context = makeContext();
    registerOwnedAgenticModelSurface(context, {
      listOwned: async () => [
        { id: "gemma-4-12b-it-gguf", displayName: "Gemma 4 12B" },
      ],
      loadSnapshot: async () => ({
        schemaVersion: 1,
        orderedIds: ["gemma-4-12b-it-gguf"],
        recommendedByTask: { agentic: "gemma-4-12b-it-gguf" },
        downloadedSinceInstall: [],
      }),
      getCurrentModelName: () => "gemma-4-12b-it-gguf",
      updateModelName: async () => undefined,
    });
    const ids = (
      vscode.commands.registerCommand as ReturnType<typeof vi.fn>
    ).mock.calls.map((call: unknown[]) => call[0]);
    expect(ids).toContain(SELECT_MODEL_COMMAND);
    expect(vscode.window.createStatusBarItem).toHaveBeenCalled();
    expect(context.subscriptions.length).toBeGreaterThan(0);
  });

  it("shows the Settings message when the owned set is empty", async () => {
    const selected = await promptOwnedAgenticModel([]);
    expect(selected).toBeUndefined();
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      EMPTY_OWNED_AGENTIC_MESSAGE,
    );
    expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
  });

  it("returns the picked owned id", async () => {
    (vscode.window.showQuickPick as ReturnType<typeof vi.fn>).mockResolvedValue(
      {
        label: "Gemma 4 12B",
        description: "gemma-4-12b-it-gguf",
      },
    );
    const selected = await promptOwnedAgenticModel([
      { id: "gemma-4-12b-it-gguf", displayName: "Gemma 4 12B" },
      { id: "qwen2.5-coder:14b", displayName: "Qwen2.5 Coder 14B" },
    ]);
    expect(selected).toBe("gemma-4-12b-it-gguf");
  });

  it("writes the recommended owned id when settings still have a leftover tag", async () => {
    const updateModelName = vi.fn().mockResolvedValue(undefined);
    const context = makeContext();
    const { ready } = registerOwnedAgenticModelSurface(context, {
      listOwned: async () => [
        { id: "gemma-4-12b-it-gguf", displayName: "Gemma 4 12B" },
      ],
      loadSnapshot: async () => ({
        schemaVersion: 1,
        orderedIds: ["gemma-4-12b-it-gguf"],
        recommendedByTask: { agentic: "gemma-4-12b-it-gguf" },
        downloadedSinceInstall: [],
      }),
      getCurrentModelName: () => "gemma4:e4b",
      updateModelName,
    });
    await ready;
    expect(updateModelName).toHaveBeenCalledWith("gemma-4-12b-it-gguf");
  });

  it("applies a QuickPick selection from the command handler", async () => {
    const updateModelName = vi.fn().mockResolvedValue(undefined);
    const context = makeContext();
    registerOwnedAgenticModelSurface(context, {
      listOwned: async () => [
        { id: "gemma-4-12b-it-gguf", displayName: "Gemma 4 12B" },
        { id: "qwen2.5-coder:14b", displayName: "Qwen2.5 Coder 14B" },
      ],
      loadSnapshot: async () => ({
        schemaVersion: 1,
        orderedIds: ["gemma-4-12b-it-gguf", "qwen2.5-coder:14b"],
        recommendedByTask: { agentic: "gemma-4-12b-it-gguf" },
        downloadedSinceInstall: [],
      }),
      getCurrentModelName: () => "gemma-4-12b-it-gguf",
      updateModelName,
    });
    (vscode.window.showQuickPick as ReturnType<typeof vi.fn>).mockResolvedValue(
      {
        label: "Qwen2.5 Coder 14B",
        description: "qwen2.5-coder:14b",
      },
    );
    const handler = (
      vscode.commands.registerCommand as ReturnType<typeof vi.fn>
    ).mock.calls.find((call: unknown[]) => call[0] === SELECT_MODEL_COMMAND)?.[1] as
      | (() => Promise<void>)
      | undefined;
    expect(handler).toBeDefined();
    await handler?.();
    expect(updateModelName).toHaveBeenCalledWith("qwen2.5-coder:14b");
  });

  it("refreshes the status bar when nexus.llm.modelName changes", async () => {
    const context = makeContext();
    const { ready } = registerOwnedAgenticModelSurface(context, {
      listOwned: async () => [
        { id: "gemma-4-12b-it-gguf", displayName: "Gemma 4 12B" },
      ],
      loadSnapshot: async () => ({
        schemaVersion: 1,
        orderedIds: ["gemma-4-12b-it-gguf"],
        recommendedByTask: { agentic: "gemma-4-12b-it-gguf" },
        downloadedSinceInstall: [],
      }),
      getCurrentModelName: () => "gemma-4-12b-it-gguf",
      updateModelName: async () => undefined,
    });
    await ready;
    triggerConfigurationChange((section) => section === "nexus.llm.modelName");
  });

  it("shows No agentic model when listOwned throws", async () => {
    const context = makeContext();
    const { ready } = registerOwnedAgenticModelSurface(context, {
      listOwned: async () => {
        throw new Error("disk");
      },
      loadSnapshot: async () => null,
      getCurrentModelName: () => "gemma4:e4b",
      updateModelName: async () => undefined,
    });
    await ready;
    const bar = (vscode.window.createStatusBarItem as ReturnType<typeof vi.fn>)
      .mock.results[0]?.value as { text: string };
    expect(bar.text).toContain("No agentic model");
  });
});
