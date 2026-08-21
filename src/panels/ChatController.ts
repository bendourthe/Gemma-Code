import * as vscode from "vscode";
import { StreamingPipeline } from "../../modules/coding/chat/StreamingPipeline.js";
import { detectPlan } from "../../modules/coding/chat/PlanMode.js";
import { PlanArchive } from "../storage/PlanArchive.js";
import type { ConversationManager } from "../../modules/coding/chat/ConversationManager.js";
import { ContextCompactor } from "../../modules/coding/chat/ContextCompactor.js";
import type { PromptBuilder } from "../../modules/coding/chat/PromptBuilder.js";
import { Orchestrator } from "../../modules/coding/orchestration/Orchestrator.js";
import type { SkillLoader } from "../../modules/coding/skills/SkillLoader.js";
import type { MemoryStore } from "../storage/MemoryStore.js";
import type { UnifiedMemoryRetriever } from "../storage/UnifiedMemoryRetriever.js";
import type { WorkingMemory } from "../storage/WorkingMemory.js";
import type { EpisodicMemory } from "../storage/EpisodicMemory.js";
import type { MemoryConsolidator } from "../storage/MemoryConsolidator.js";
import { SubAgentManager } from "../../modules/coding/agents/SubAgentManager.js";
import { AgentLoop, type PathScopedSkillSource } from "../tools/AgentLoop.js";
import {
  InboundClassifier,
  createLlmInboundScreener,
} from "../../modules/coding/security/InboundClassifier.js";
import type { HookBus } from "../../core/lifecycle/HookBus.js";
import type { ToolRegistry } from "../tools/ToolRegistry.js";
import type { OllamaToolDefinition } from "../../modules/coding/llm/types.js";
import type { LLMClient } from "../../modules/coding/llm/types.js";
import type { GitSafetyNet } from "../../modules/coding/guardrails/GitSafetyNet.js";
import { LoopDetector } from "../../modules/coding/guardrails/LoopDetector.js";
import { LoopGuards } from "../../modules/coding/guardrails/LoopGuards.js";
import { toolFormatForModel } from "../../modules/coding/llm/parseAgentToolCalls.js";
import {
  composePassStateGating,
  composeVerificationEnabled,
  parseSecurityPosture,
} from "../../modules/coding/guardrails/SecurityPosture.js";
import type { OperationLog } from "../../modules/coding/observability/OperationLog.js";
import type { Tracer } from "../../modules/coding/observability/Tracer.js";
import type { HardwareTierConfig } from "../../modules/coding/config/HardwareTier.types.js";
import type { GemmaCodeSettings } from "../../modules/coding/config/settings.js";
import type { PanelRouter } from "../../modules/coding/llm/PanelRouter.js";
import { calculateBudget, resolveModelContextLimit } from "../../modules/coding/config/PromptBudget.js";
import { renderMarkdown } from "../../modules/coding/utils/MarkdownRenderer.js";
import { getLogger } from "../../modules/coding/utils/logger.js";
import type { ExtensionToWebviewMessage } from "./messages.js";
import { ChatCommandHandlers, type ChatCommandContext } from "./ChatCommandHandlers.js";

/**
 * Common Ollama tunables passed into every subsystem that calls the LLM.
 * Sourced from {@link GemmaCodeSettings}; identical to what
 * `NexusCodingPanel` previously assembled inline.
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
  /** v1.5.0 Phase 4 (item 36): opt-in swarm orchestration (worktree-isolated workers + critic gate). Default off. */
  readonly swarmEnabled?: boolean;
  /** v1.6.0 Phase 4 (A2): shared tracer so planner/worker/critic sub-runs nest in one trace. */
  readonly tracer?: Tracer;
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
  /** v1.4.0 Phase 8 (gap 5.4.P3.T): lifecycle bus for session.reflection + the A8 PreCompact hook. */
  readonly hookBus?: HookBus;
  /** v1.4.0 Phase 8 (gap 5.2.P3.Q): path-scoped skill source for focus-change reevaluation. */
  readonly skillCatalog?: PathScopedSkillSource;
  /** v1.4.0 Phase 8 (gap 5.2.P3.Q): supplies the active editing path at run start. */
  readonly activeEditPathProvider?: () => string | null;
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
  /**
   * v1.6.0 adoption-openrouter-fusion Phase 5 (OF011) -- the opt-in budget-panel
   * router. When non-null (built only when `nexus.llm.panelRouting` is on), a
   * normal chat turn is offered to the router first; a `panel` decision renders
   * the fused answer and short-circuits the single-model pipeline. `null` (the
   * default) leaves the chat turn byte-identical to the pre-OF011 path.
   */
  readonly panelRouter?: PanelRouter | null;
  /**
   * v1.6.0 adoption-openrouter-fusion Phase 5 (OF011) -- supplies the distinct
   * installed-model panel spec (models other than the primary) the router fans
   * out across. Only consulted when `panelRouter` is non-null.
   */
  panelSpecProvider?(): Promise<readonly string[]>;
  getUnifiedRetriever(): UnifiedMemoryRetriever | null;
  /**
   * v1.5.0 Phase 7 (HUB.P3.CMD): resolve a Nexus-Hub command body by name.
   * Optional -- absent in legacy/test contexts and when no Hub bundle is synced.
   */
  getHubCommand?(name: string): { body: string } | null;
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
      swarmEnabled: deps.swarmEnabled,
      ...(deps.tracer ? { tracer: deps.tracer } : {}),
    });
  }

  static buildAgentLoop(deps: AgentLoopBuildDeps): AgentLoop {
    // v1.5.0 Phase 3 (item 3): construct the inbound prompt-injection
    // classifier. The deterministic heuristic is always wired; the local-model
    // second opinion is added only when the operator opts into deep-scan (off
    // by default, so the common path makes no per-fetch model call).
    const inboundClassifier = new InboundClassifier({
      modelScreener: deps.settings.inboundClassifierDeepScan
        ? createLlmInboundScreener(deps.client, deps.modelName)
        : undefined,
      logger: (message) => getLogger().warn(message),
    });
    const loopDetector = new LoopDetector();
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
        inboundClassifier,
        inboundClassifierEnabled: deps.settings.inboundClassifierEnabled,
        verificationThreshold: deps.settings.verificationThreshold,
        verificationEnabled: composeVerificationEnabled(
          parseSecurityPosture(deps.settings.securityPosture),
          deps.settings.verificationEnabled,
        ),
        auditWorkerEnabled: deps.settings.auditWorkerEnabled,
        testgapsWorkerEnabled: deps.settings.testgapsWorkerEnabled,
        curatorWorkerEnabled: deps.settings.curatorWorkerEnabled,
        workingMemory: deps.workingMemory ?? undefined,
        episodicMemory: deps.episodicMemory ?? undefined,
        sessionId: deps.manager.sessionId ?? undefined,
        gitSafetyNet: deps.gitSafetyNet ?? undefined,
        loopDetector,
        loopGuards: new LoopGuards(undefined, loopDetector),
        securityPosture: parseSecurityPosture(deps.settings.securityPosture),
        maxTokens: deps.settings.maxTokens,
        tracer: deps.tracer,
        operationLog: deps.operationLog ?? undefined,
        passStateGating: composePassStateGating(
          parseSecurityPosture(deps.settings.securityPosture),
          deps.settings.passStateGating,
        ),
        subAgentVerificationCredit: deps.settings.passStateSubAgentCredit,
        hookBus: deps.hookBus,
        skillCatalog: deps.skillCatalog,
        activeEditPathProvider: deps.activeEditPathProvider,
        toolFormat: toolFormatForModel(deps.modelName),
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

      // v1.5.0 Phase 7 (HUB.P3.CMD): a Nexus-Hub command injects its markdown
      // body as the agent directive (the same shape as a skill prompt).
      if (command.type === "hub-command") {
        const hub = ctx.getHubCommand?.(command.name) ?? null;
        if (!hub) {
          postMessage({ type: "error", text: `Hub command "${command.name}" could not be loaded.` });
          return;
        }
        const expanded = hub.body.replace(/\$ARGUMENTS/g, command.args);
        const combined = `${expanded}\n\n${command.args}`.trim();
        await this._injectMemoryContext(command.args || combined);
        await ctx.pipeline.send(combined, postWithRender);
        this._checkForPlan();
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
      // v1.1.0 Phase 8.5 -- attach skill provenance so every tool_call span
      // inside the skill's body carries `skill.{id, namespace, ...}`. We
      // address the user-loaded SkillLoader entry as `user/<name>` so the
      // span's namespace matches the namespace surfaced in the autocomplete
      // (the agentic-side built-in catalog already runs without setCurrentSkill).
      const skillSpan = {
        id: `user/${skill.name}`,
        namespace: "user" as const,
      };
      ctx.agentLoop.setCurrentSkill(skillSpan);
      try {
        await ctx.pipeline.send(combinedText, postWithRender);
        metrics?.recordInvocation(command.name, "success", Date.now() - startedAt);
      } catch (err) {
        metrics?.recordInvocation(command.name, "failure", Date.now() - startedAt);
        throw err;
      } finally {
        ctx.agentLoop.setCurrentSkill(null);
      }
      this._checkForPlan();
      return;
    }

    if (ctx.planMode.active && ctx.orchestrator.shouldUseOrchestrator(text)) {
      await this._runOrchestrator(text, postWithRender);
      return;
    }

    // v1.6.0 adoption-openrouter-fusion Phase 5 (OF011): offer the turn to the
    // opt-in budget-panel router. When it escalates to (and runs) a panel, the
    // fused answer is rendered here and the single-model pipeline is skipped.
    // When the router is null (the default) or it keeps the single model, this
    // is a no-op and the turn falls through unchanged.
    if (await this._consultPanel(text, postWithRender)) {
      return;
    }

    await this._injectMemoryContext(text);
    await ctx.pipeline.send(text, postWithRender);
    this._checkForPlan();
  }

  /**
   * v1.6.0 adoption-openrouter-fusion Phase 5 (OF011) -- live panel-routing
   * consult. Returns `true` when the router escalated to a panel and the fused
   * answer was rendered (the caller must then short-circuit the single-model
   * path); returns `false` when there is no router, when the decision was to
   * stay on the single model, or when anything failed -- in which case the
   * caller proceeds with the normal pipeline so the user's turn is never lost.
   *
   * The fused answer is appended exactly the way `StreamingPipeline` commits an
   * assistant message: the user turn is recorded first (so history + the chat
   * store match the single-model path), then the assistant message, then a
   * `messageComplete` with an empty `renderedHtml` so `postWithRender` renders
   * the markdown from history by message id -- identical to the streaming path.
   */
  private async _consultPanel(
    text: string,
    postWithRender: (msg: ExtensionToWebviewMessage) => void,
  ): Promise<boolean> {
    const ctx = this._ctx;
    const router = ctx.panelRouter ?? null;
    if (!router || !ctx.panelSpecProvider) return false;

    try {
      const panelSpec = await ctx.panelSpecProvider();
      const routed = await router.route({
        task: text,
        highReliability: true,
        singleModel: ctx.getSettings().modelName,
        panelSpec,
      });
      if (routed.decision.kind !== "panel" || !routed.run) {
        return false;
      }

      ctx.manager.addUserMessage(text);
      const msg = ctx.manager.addAssistantMessage(routed.run.fusion.fusedOutput);
      postWithRender({
        type: "messageComplete",
        messageId: msg.id,
        renderedHtml: "",
      });
      this._checkForPlan();
      return true;
    } catch (err) {
      getLogger().warn("[PanelRouter] Panel consult failed; using single model:", err);
      return false;
    }
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
