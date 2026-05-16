import * as vscode from "vscode";
import type { ConversationManager } from "../chat/ConversationManager.js";
import type { PlanMode } from "../chat/PlanMode.js";
import type { PromptBuilder } from "../chat/PromptBuilder.js";
import type { PromptContext } from "../chat/PromptBuilder.types.js";
import type { CommandRouter } from "../commands/CommandRouter.js";
import type { GemmaCodeSettings } from "../config/settings.js";
import type { GitSafetyNet } from "../guardrails/GitSafetyNet.js";
import type { ConfirmationGate } from "../tools/ConfirmationGate.js";
import type { AgentLoop } from "../tools/AgentLoop.js";
import type { EditMode } from "../tools/types.js";
import { formatForUser } from "../utils/errors.js";
import type { ChatController } from "./ChatController.js";
import type { ChatStatusReporter } from "./ChatStatusReporter.js";
import type {
  ExtensionToWebviewMessage,
  WebviewToExtensionMessage,
} from "./messages.js";

export interface ChatMessageRouterDeps {
  readonly controller: ChatController;
  readonly status: ChatStatusReporter;
  readonly manager: ConversationManager;
  readonly planMode: PlanMode;
  readonly promptBuilder: PromptBuilder;
  readonly commandRouter: CommandRouter;
  readonly confirmationGate: ConfirmationGate;
  readonly agentLoop: AgentLoop;
  readonly gitSafetyNet: GitSafetyNet | null;
  getSettings(): GemmaCodeSettings;
  getCurrentEditMode(): EditMode;
  setCurrentEditMode(mode: EditMode): void;
  buildPromptContext(memoryContext?: string): PromptContext;
  postMessage(msg: ExtensionToWebviewMessage): void;
  getOutputChannel(): vscode.OutputChannel;
}

/**
 * Webview-to-extension message dispatch extracted from
 * {@link GemmaCodePanel} as part of v0.7.0 Phase 0 sub-task 0.4. The router
 * holds no panel-private state; it delegates to {@link ChatController} for
 * flow, to {@link ChatStatusReporter} for status pushes, and to small
 * handlers for the load-session / set-edit-mode / rollback paths that
 * touch panel-owned mutable state through the supplied callbacks.
 */
export class ChatMessageRouter {
  constructor(private readonly _deps: ChatMessageRouterDeps) {}

  async handle(message: WebviewToExtensionMessage): Promise<void> {
    const deps = this._deps;
    switch (message.type) {
      case "ready":
        deps.status.postHistory();
        deps.postMessage({
          type: "planModeToggled",
          active: deps.planMode.active,
        });
        deps.postMessage({
          type: "editModeChanged",
          mode: deps.getCurrentEditMode(),
        });
        deps.status.postTokenCount();
        deps.status.postMemoryStatus();
        deps.status.postMcpStatus();
        deps.status.postThinkingModeStatus();
        break;

      case "requestCommandList":
        deps.postMessage({
          type: "commandList",
          commands: deps.commandRouter.getAllDescriptors(),
        });
        break;

      case "sendMessage":
        await deps.controller.submitUserMessage(message.text);
        break;

      case "clearChat":
        deps.manager.clearHistory();
        deps.planMode.resetPlan();
        deps.status.postHistory();
        deps.status.postTokenCount();
        break;

      case "cancelStream":
        deps.controller.cancelInFlight();
        break;

      case "confirmationResponse":
        deps.confirmationGate.resolve(message.id, message.approved);
        break;

      case "permissionPromptResponse":
        // v0.8.0 Phase 0.4 (closes v0.7.0 10.O.1): route the numbered
        // permission prompt's response to the gate. The legacy `confirmationResponse`
        // path stays for the boolean Yes/No card; this case feeds the
        // 4-option (`yes` / `yes-for-all` / `no` / `freeform`) prompt.
        deps.confirmationGate.resolvePrompt(message.id, {
          value: message.value,
          freeformText: message.freeformText,
        });
        break;

      case "approveStep":
        await deps.controller.approveStep(message.step);
        break;

      case "loadSession":
        this._handleLoadSession(message.sessionId);
        break;

      case "setEditMode":
        await this._handleSetEditMode(message.mode);
        break;

      case "rollbackRequest":
        await this._handleRollback();
        break;
    }
  }

  private _handleLoadSession(sessionId: string): void {
    const deps = this._deps;
    const loaded = deps.manager.loadSession(sessionId);
    if (loaded) {
      deps.planMode.resetPlan();
      deps.postMessage({ type: "planModeToggled", active: false });
      deps.status.postHistory();
      deps.status.postTokenCount();
    }
  }

  private async _handleSetEditMode(mode: EditMode): Promise<void> {
    const deps = this._deps;
    deps.setCurrentEditMode(mode);
    vscode.workspace
      .getConfiguration("gemma-code")
      .update("editMode", mode, vscode.ConfigurationTarget.Global)
      .then(undefined, (err: unknown) => {
        const message = formatForUser(err);
        deps
          .getOutputChannel()
          .appendLine(
            `[config] Failed to save editMode='${mode}' to global settings: ${message}`,
          );
      });
    deps.postMessage({ type: "editModeChanged", mode });

    const shouldPlan = mode === "plan";
    if (shouldPlan !== deps.planMode.active) {
      deps.planMode.toggle();
      const prompt = deps.promptBuilder.build(deps.buildPromptContext());
      deps.manager.rebuildSystemPrompt(prompt);
      deps.postMessage({
        type: "planModeToggled",
        active: shouldPlan,
      });
    }
  }

  private async _handleRollback(): Promise<void> {
    const deps = this._deps;
    const checkpoint = deps.agentLoop.getLastCheckpoint();
    if (checkpoint && deps.gitSafetyNet) {
      const success = await deps.gitSafetyNet.rollback(checkpoint);
      deps.postMessage({
        type: "error",
        text: success
          ? `Rolled back to checkpoint ${checkpoint.headSha.slice(0, 7)}.`
          : "Rollback failed. Check git status manually.",
      });
    }
  }
}
