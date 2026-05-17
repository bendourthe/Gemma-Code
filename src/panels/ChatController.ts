import * as vscode from "vscode";
import { StreamingPipeline } from "../chat/StreamingPipeline.js";
import { detectPlan } from "../chat/PlanMode.js";
import { PlanArchive } from "../storage/PlanArchive.js";
import type { ConversationManager } from "../chat/ConversationManager.js";
import { ContextCompactor } from "../chat/ContextCompactor.js";
import type { PromptBuilder } from "../chat/PromptBuilder.js";
import { Orchestrator } from "../orchestration/Orchestrator.js";
import type { SkillLoader } from "../skills/SkillLoader.js";
import type { MemoryStore } from "../storage/MemoryStore.js";
import type { UnifiedMemoryRetriever } from "../storage/UnifiedMemoryRetriever.js";
import type { WorkingMemory } from "../storage/WorkingMemory.js";
import type { EpisodicMemory } from "../storage/EpisodicMemory.js";
import type { MemoryConsolidator } from "../storage/MemoryConsolidator.js";
import { SubAgentManager } from "../agents/SubAgentManager.js";
import { AgentLoop } from "../tools/AgentLoop.js";
import type { ToolRegistry } from "../tools/ToolRegistry.js";
import type { OllamaToolDefinition } from "../llm/types.js";
import type { LLMClient } from "../llm/types.js";
import type { GitSafetyNet } from "../guardrails/GitSafetyNet.js";
import { LoopDetector } from "../guardrails/LoopDetector.js";
import type { OperationLog } from "../observability/OperationLog.js";
import type { Tracer } from "../observability/Tracer.js";
import type { HardwareTierConfig } from "../config/HardwareTier.types.js";
import type { GemmaCodeSettings } from "../config/settings.js";
import { calculateBudget, resolveModelContextLimit } from "../config/PromptBudget.js";
import { renderMarkdown } from "../utils/MarkdownRenderer.js";
import { getLogger } from "../utils/logger.js";
import type { ExtensionToWebviewMessage } from "./messages.js";
import { ChatCommandHandlers, type ChatCommandContext } from "./ChatCommandHandlers.js";

/**
 * Common Ollama tunables passed into every subsystem that calls the LLM.
 * Sourced from {@link GemmaCodeSettings}; identical to what
 * `GemmaCodePanel` previously assembled inline.
 */
export interface OllamaTuning {
  readonly num_ctx: number;
  readonly temperature: number;
  readonly top_p: number;
  readonly top_k: number;
}

export function buildOllamaTuning(settings: GemmaCodeSettings): OllamaTuning {
  return {
    num_ctx: settings.maxTokens,
    temperature: settings.temperature,
    top_p: settings.topP,
    top_k: settings.topK,
  };
}

export interface ContextCompactorBuildDeps {
  readonly manager: ConversationManager;
  readonly client: LLMClient;
  readonly settings: GemmaCodeSettings;
  readonly ollamaOptions: OllamaTuning;
  readonly memoryStore: MemoryStore | null;
  readonly memoryConsolidator: MemoryConsolidator | null;
  readonly tracer: Tracer;
  getSettings(): GemmaCodeSettings;
}

export interface SubAgentManagerBuildDeps {
  readonly client: LLMClient;
  readonly promptBuilder: PromptBuilder;
  readonly memoryStore: MemoryStore | null;
  readonly ollamaOptions: OllamaTuning;
  readonly modelName: string;
  readonly tracer: Tracer;
}

export interface OrchestratorBuildDeps {
  readonly client: LLMClient;
  readonly modelName: string;
  readonly ollamaOptions: OllamaTuning;
  readonly subAgentManager: SubAgentManager;
  readonly hardwareTier: HardwareTierConfig;
  readonly memoryStore: MemoryStore | null;
  readonly postMessage: (msg: ExtensionToWebviewMessage) => void;
}

export interface AgentLoopBuildDeps {
  readonly client: LLMClient;
  readonly manager: ConversationManager;
  readonly registry: ToolRegistry;
  readonly modelName: string;
  readonly maxIterations: number;
  readonly compactor: ContextCompactor;
  readonly ollamaOptions: OllamaTuning;
  readonly ollamaTools: OllamaToolDefinition[];
  readonly subAgentManager: SubAgentManager;
  readonly settings: GemmaCodeSettings;
  readonly workingMemory: WorkingMemory | null;
  readonly episodicMemory: EpisodicMemory | null;
  readonly gitSafetyNet: GitSafetyNet | null;
  readonly tracer: Tracer;
  readonly operationLog: OperationLog | null;
}

/**
 * Dependencies the controller needs in addition to the slash-command context.
 * Splitting these out keeps the slash-command handlers re-usable in tests
 * without requiring the agent-loop / pipeline / orchestrator to be wired.
 */
export interface ChatControllerContext extends ChatCommandContext {
  readonly pipeline: StreamingPipeline;
  readonly orchestrator: Orchestrator;
  readonly skillLoader: SkillLoader;
  /**
   * v0.8.0 Phase 3.2 -- persistent plan-version archive. Optional because the
   * legacy test harness does not always wire it. When present, the controller
   * appends every detected plan and emits `renderPlanDiff` on the second-and-
   * later versions.
   */
  readonly planArchive?: PlanArchiveLike;
  getUnifiedRetriever(): UnifiedMemoryRetriever | null;
}

/**
 * Structural slice of {@link PlanArchive} the controller needs. Declared as a
 * minimal port so tests can substitute an in-memory fake without depending on
 * `node:fs`.
 */
export interface PlanArchiveLike {
  appendVersion(slug: string, content: string): number;
  getVersion(slug: string, version: number): string | null;
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

  // -------------------------------------------------------------------------
  // Static factories — v0.7.0 Phase 0 sub-task 0.4 hoist. The owning panel
  // builds primitives (settings, runtime, memory subsystem) then asks the
  // controller to assemble the agent-loop construction graph. Keeping these
  // as static methods preserves the existing `ChatControllerContext`
  // injection contract used by the unit tests.
  // -------------------------------------------------------------------------

  static buildContextCompactor(deps: ContextCompactorBuildDeps): ContextCompactor {
    const { manager, client, settings, ollamaOptions, memoryStore, memoryConsolidator, tracer } = deps;
    // v0.7.0 Phase 3 sub-task 3.7: per-model context override.
    const effectiveMaxTokens = resolveModelContextLimit(
      settings.modelName,
      settings.maxTokens,
      settings.contextLimitsPerModel ?? {},
    );
    const compactor = new ContextCompactor(
      manager,
      client,
      settings.modelName,
      effectiveMaxTokens,
      ollamaOptions,
      settings.memoryEnabled && memoryStore
        ? async (messages) => {
            try {
              await memoryStore.extractAndSave(
                messages,
                manager.sessionId ?? undefined,
              );
              memoryStore.prune(settings.memoryMaxEntries);
            } catch (err) {
              getLogger().warn("[MemoryStore] Pre-compaction extraction failed:", err);
            }
          }
        : undefined,
      0.8,
      undefined,
      tracer,
      () => deps.getSettings(),
    );
    if (memoryConsolidator) {
      compactor.setPostCompactionHook(async (sessionId) => {
        await memoryConsolidator.consolidate(sessionId);
      });
    }
    return compactor;
  }

  static buildSubAgentManager(deps: SubAgentManagerBuildDeps): SubAgentManager {
    return new SubAgentManager(
      deps.client,
      deps.promptBuilder,
      deps.memoryStore,
      deps.ollamaOptions,
      deps.modelName,
      deps.tracer,
    );
  }

  static buildOrchestrator(deps: OrchestratorBuildDeps): Orchestrator {
    return new Orchestrator({
      client: deps.client,
      modelName: deps.modelName,
      ollamaOptions: deps.ollamaOptions,
      subAgentManager: deps.subAgentManager,
      hardwareTier: deps.hardwareTier,
      memoryStore: deps.memoryStore,
      postMessage: deps.postMessage,
    });
  }

  static buildAgentLoop(deps: AgentLoopBuildDeps): AgentLoop {
    return new AgentLoop(
      deps.client,
      deps.manager,
      deps.registry,
      deps.modelName,
      deps.maxIterations,
      deps.compactor,
      deps.ollamaOptions,
      deps.ollamaTools,
      {
        subAgentManager: deps.subAgentManager,
        verificationThreshold: deps.settings.verificationThreshold,
        verificationEnabled: deps.settings.verificationEnabled,
        auditWorkerEnabled: deps.settings.auditWorkerEnabled,
        testgapsWorkerEnabled: deps.settings.testgapsWorkerEnabled,
        curatorWorkerEnabled: deps.settings.curatorWorkerEnabled,
        workingMemory: deps.workingMemory ?? undefined,
        episodicMemory: deps.episodicMemory ?? undefined,
        sessionId: deps.manager.sessionId ?? undefined,
        gitSafetyNet: deps.gitSafetyNet ?? undefined,
        loopDetector: new LoopDetector(),
        maxTokens: deps.settings.maxTokens,
        tracer: deps.tracer,
        operationLog: deps.operationLog ?? undefined,
        passStateGating: deps.settings.passStateGating,
        subAgentVerificationCredit: deps.settings.passStateSubAgentCredit,
      },
    );
  }

  static buildStreamingPipeline(deps: {
    client: LLMClient;
    manager: ConversationManager;
    modelName: string;
    agentLoop: AgentLoop;
    ollamaOptions: OllamaTuning;
    ollamaTools: OllamaToolDefinition[];
  }): StreamingPipeline {
    return new StreamingPipeline(
      deps.client,
      deps.manager,
      deps.modelName,
      (pm) => deps.agentLoop.run(pm),
      deps.ollamaOptions,
      deps.ollamaTools,
    );
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
      // v0.8.0 Phase 5 sub-task 5.1 -- record per-skill invocation. Outcome is
      // success unless `pipeline.send` throws, which we surface as `failure`.
      // The optional getSkillMetrics getter is missing on legacy test contexts;
      // guard before reading so older tests stay green.
      const metrics = ctx.getSkillMetrics?.() ?? null;
      const startedAt = Date.now();
      try {
        await ctx.pipeline.send(combinedText, postWithRender);
        metrics?.recordInvocation(command.name, "success", Date.now() - startedAt);
      } catch (err) {
        metrics?.recordInvocation(command.name, "failure", Date.now() - startedAt);
        throw err;
      }
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
   *
   * v0.8.0 Phase 3.2 -- when a {@link PlanArchive} is wired in, every detected
   * plan is appended as a new version. The second-and-later version emits a
   * `renderPlanDiff` message so the webview can surface a side-by-side diff
   * against the prior plan before the user approves or denies.
   */
  private _checkForPlan(): void {
    const ctx = this._ctx;
    if (!ctx.planMode.active) return;

    const history = ctx.manager.getHistory();
    const lastAssistant = [...history].reverse().find((m) => m.role === "assistant");
    if (!lastAssistant) return;

    const steps = detectPlan(lastAssistant.content);
    if (!(steps && steps.length >= 2)) return;

    ctx.planMode.setPlan(steps);
    ctx.postMessage({ type: "planReady", steps });

    if (!ctx.planArchive) return;
    const slug = this._planSlug();
    const planContent = this._formatPlanForArchive(steps);
    try {
      const previousVersion = ctx.planArchive.getVersion(slug, this._lastPlanVersion);
      const newVersion = ctx.planArchive.appendVersion(slug, planContent);
      this._lastPlanVersion = newVersion;
      if (previousVersion !== null) {
        const result = PlanArchive.computeDiff(
          previousVersion,
          planContent,
          slug,
          newVersion - 1,
          newVersion,
        );
        ctx.postMessage({
          type: "renderPlanDiff",
          planSlug: slug,
          fromVersion: newVersion - 1,
          toVersion: newVersion,
          clean: result.clean,
          classic: result.classic,
          raw: result.raw,
        });
      }
    } catch (err) {
      getLogger().warn("[PlanArchive] Failed to archive plan revision:", err);
    }
  }

  /**
   * Derive a filesystem-safe plan slug. Uses the active session id when
   * available so each chat has its own version line; falls back to
   * `unsessioned` for ad-hoc tests and pre-session capture.
   */
  private _planSlug(): string {
    const session = this._ctx.manager.sessionId;
    if (!session) return "unsessioned";
    return session.replace(/[^A-Za-z0-9._-]/g, "_");
  }

  /** Tracks the last successfully written version so diff() can resolve the prior content. */
  private _lastPlanVersion = 0;

  /** Render the canonical archive form for a plan -- a numbered markdown list. */
  private _formatPlanForArchive(steps: readonly string[]): string {
    return steps.map((s, i) => `${i + 1}. ${s}`).join("\n") + "\n";
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
