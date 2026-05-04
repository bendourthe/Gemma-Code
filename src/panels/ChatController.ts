import * as vscode from "vscode";
import type { StreamingPipeline } from "../chat/StreamingPipeline.js";
import { detectPlan } from "../chat/PlanMode.js";
import type { Orchestrator } from "../orchestration/Orchestrator.js";
import type { SkillLoader } from "../skills/SkillLoader.js";
import type { MemoryStore } from "../storage/MemoryStore.js";
import type { UnifiedMemoryRetriever } from "../storage/UnifiedMemoryRetriever.js";
import { calculateBudget } from "../config/PromptBudget.js";
import { renderMarkdown } from "../utils/MarkdownRenderer.js";
import type { ExtensionToWebviewMessage } from "./messages.js";
import { ChatCommandHandlers, type ChatCommandContext } from "./ChatCommandHandlers.js";

/**
 * Dependencies the controller needs in addition to the slash-command context.
 * Splitting these out keeps the slash-command handlers re-usable in tests
 * without requiring the agent-loop / pipeline / orchestrator to be wired.
 */
export interface ChatControllerContext extends ChatCommandContext {
  readonly pipeline: StreamingPipeline;
  readonly orchestrator: Orchestrator;
  readonly skillLoader: SkillLoader;
  getUnifiedRetriever(): UnifiedMemoryRetriever | null;
}

/**
 * Owns the agent-loop wiring, the StreamingPipeline lifecycle, the slash
 * command dispatch, plan-mode follow-up, and orchestrator path. The owning
 * panel becomes a thin VS Code-side surface that delegates user input here.
 *
 * The controller does not own the webview; it accepts a {@link postMessage}
 * callback (provided via the supplied {@link ChatControllerContext}) so it
 * can be tested with a stub message bus.
 */
export class ChatController {
  private readonly _commandHandlers: ChatCommandHandlers;

  constructor(private readonly _ctx: ChatControllerContext) {
    this._commandHandlers = new ChatCommandHandlers(_ctx);
  }

  /** Cancel the in-flight stream and the agent loop. */
  cancelInFlight(): void {
    this._ctx.pipeline.cancel();
    this._ctx.agentLoop.cancel();
  }

  /**
   * Handle the user's chat input. Routes through the slash-command router,
   * then the orchestrator (when plan mode is on and the request is complex),
   * and finally the streaming pipeline. Errors propagate to the webview as
   * `error` messages via the supplied postMessage callback.
   */
  async submitUserMessage(text: string): Promise<void> {
    const ctx = this._ctx;
    const postMessage = (msg: ExtensionToWebviewMessage): void =>
      ctx.postMessage(msg);

    const postWithRender = (msg: ExtensionToWebviewMessage): void => {
      if (msg.type === "messageComplete" && !msg.renderedHtml) {
        const history = ctx.manager.getHistory();
        const found = history.find((m) => m.id === msg.messageId);
        postMessage({
          ...msg,
          renderedHtml: found ? renderMarkdown(found.content) : "",
        });
        ctx.postTokenCount();
        return;
      }
      postMessage(msg);
    };

    const command = ctx.commandRouter.route(text);

    if (command !== null) {
      if (command.type === "builtin") {
        await this._commandHandlers.dispatch(command.name, command.args);
        return;
      }

      const skill = ctx.skillLoader.getSkill(command.name);
      if (!skill) {
        postMessage({
          type: "error",
          text: `Skill "${command.name}" could not be loaded.`,
        });
        return;
      }

      const expandedPrompt = skill.prompt.replace(/\$ARGUMENTS/g, command.args);
      const combinedText = `${expandedPrompt}\n\n${command.args}`.trim();

      await this._injectMemoryContext(command.args || combinedText);
      await ctx.pipeline.send(combinedText, postWithRender);
      this._checkForPlan();
      return;
    }

    if (ctx.planMode.active && ctx.orchestrator.shouldUseOrchestrator(text)) {
      await this._runOrchestrator(text, postWithRender);
      return;
    }

    await this._injectMemoryContext(text);
    await ctx.pipeline.send(text, postWithRender);
    this._checkForPlan();
  }

  /** Handle the user's "approve step" click in plan mode. */
  async approveStep(stepIndex: number): Promise<void> {
    const ctx = this._ctx;
    const { currentPlan } = ctx.planMode.state;
    const step = currentPlan[stepIndex];
    if (!step) return;

    ctx.planMode.approveStep(stepIndex);

    const instruction = `Please proceed with step ${stepIndex + 1}: ${step.description}`;
    const postWithRender = (msg: ExtensionToWebviewMessage): void => {
      if (msg.type === "messageComplete" && !msg.renderedHtml) {
        const history = ctx.manager.getHistory();
        const found = history.find((m) => m.id === msg.messageId);
        ctx.postMessage({
          ...msg,
          renderedHtml: found ? renderMarkdown(found.content) : "",
        });
        return;
      }
      ctx.postMessage(msg);
    };
    await ctx.pipeline.send(instruction, postWithRender);
    ctx.planMode.markStepDone(stepIndex);
    this._checkForPlan();
  }

  private async _runOrchestrator(
    text: string,
    postWithRender: (msg: ExtensionToWebviewMessage) => void,
  ): Promise<void> {
    const ctx = this._ctx;
    const postMessage = (msg: ExtensionToWebviewMessage): void =>
      ctx.postMessage(msg);

    postMessage({ type: "status", state: "thinking" });

    try {
      const workspacePath =
        vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
      const codebaseContext = `Workspace: ${workspacePath}`;

      const result = await ctx.orchestrator.execute(text, codebaseContext);

      const summaryMsg = ctx.manager.addAssistantMessage(result.summary);
      postWithRender({
        type: "messageComplete",
        messageId: summaryMsg.id,
        renderedHtml: renderMarkdown(result.summary),
      });
      ctx.postHistory();
      ctx.postTokenCount();
    } catch (err) {
      const errorText =
        err instanceof Error ? err.message : "Orchestrator failed";
      postMessage({ type: "error", text: errorText });
    } finally {
      postMessage({ type: "status", state: "idle" });
    }
  }

  /**
   * Detect a numbered plan in the most recent assistant message and post the
   * step list to the webview if plan mode is active. No-op otherwise.
   */
  private _checkForPlan(): void {
    const ctx = this._ctx;
    if (!ctx.planMode.active) return;

    const history = ctx.manager.getHistory();
    const lastAssistant = [...history].reverse().find((m) => m.role === "assistant");
    if (!lastAssistant) return;

    const steps = detectPlan(lastAssistant.content);
    if (steps && steps.length >= 2) {
      ctx.planMode.setPlan(steps);
      ctx.postMessage({ type: "planReady", steps });
    }
  }

  /**
   * Pre-prompt memory injection. Pulls relevant memories from the unified
   * retriever (or falls back to MemoryStore.retrieve) and rebuilds the system
   * prompt. Failures are non-fatal.
   */
  private async _injectMemoryContext(queryText: string): Promise<void> {
    const ctx = this._ctx;
    const retriever = ctx.getUnifiedRetriever();
    const memoryStore = ctx.getMemoryStore();
    if (!memoryStore && !retriever) return;

    try {
      const settings = ctx.getSettings();
      const budget = calculateBudget(settings.maxTokens);

      const memoryContext = retriever
        ? await retriever.retrieveForPrompt(queryText, budget.memoryBudget)
        : await (memoryStore as MemoryStore).retrieve(queryText, budget.memoryBudget);

      if (memoryContext) {
        const prompt = ctx.promptBuilder.build(ctx.buildPromptContext(memoryContext));
        ctx.manager.rebuildSystemPrompt(prompt);
      }
    } catch {
      // Memory query failure is non-fatal; proceed without memory context.
    }
  }
}
