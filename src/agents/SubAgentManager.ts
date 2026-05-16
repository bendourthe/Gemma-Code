import type { OllamaClient, OllamaOptions, OllamaToolDefinition } from "../llm/types.js";
import type { MemoryStore } from "../storage/MemoryStore.js";
import type { PostMessageFn } from "../chat/StreamingPipeline.js";
import type { SubAgentConfig, SubAgentResult, SubAgentType } from "./types.js";
import type { SubAgentSpawner } from "./SubAgentSpawner.types.js";
import { buildSubAgentContextMessage } from "./SubAgentPrompts.js";
import { PromptBuilder } from "../chat/PromptBuilder.js";
import { ConversationManager } from "../chat/ConversationManager.js";
import { AgentLoop } from "../tools/AgentLoop.js";
import { ToolRegistry } from "../tools/ToolRegistry.js";
import { computeToolActivation } from "../tools/ToolActivationRules.js";
import { formatForUser } from "../utils/errors.js";
import { TOOL_CATALOG, toDynamicMetadata } from "../tools/ToolCatalog.js";
import type { DynamicToolMetadata } from "../tools/ToolCatalog.js";
import { Tracer } from "../observability/Tracer.js";
import {
  ReadFileTool,
  ListDirectoryTool,
  GrepCodebaseTool,
} from "../tools/handlers/filesystem.js";
import { RunTerminalTool } from "../tools/handlers/terminal.js";
import { WebSearchTool, FetchPageTool } from "../tools/handlers/webSearch.js";
import { SpecialistLoader } from "./SpecialistLoader.js";
import type { Specialist } from "./SpecialistLoader.js";
import {
  runAuditWorker,
  runTestgapsWorker,
  runCuratorWorker,
  runReflectWorker,
} from "./BackgroundWorkers.js";
import type {
  WorkerCommandRunner,
  RunReflectWorkerOptions,
  ReflectWorkerCadenceState,
} from "./BackgroundWorkers.js";
import type { CurationLoop } from "../skills/CurationLoop.js";
import type { ReflectJob } from "../storage/ReflectJob.js";

/**
 * Hardcoded fallback tool-scope per sub-agent type. Only used when the
 * SpecialistLoader is not configured (legacy callers). When a SpecialistLoader
 * is supplied, the resolved Specialist.toolScope is the source of truth.
 */
const TOOLS_BY_TYPE: Record<SubAgentType, readonly string[]> = {
  verification: ["read_file", "grep_codebase", "list_directory", "run_terminal"],
  research: ["read_file", "grep_codebase", "list_directory", "web_search", "fetch_page"],
  planning: ["read_file", "grep_codebase", "list_directory"],
  // v0.7.0 Phase 7 (C34): workers do not call the LLM; they spawn an external
  // CLI directly. The tool scope is empty -- their run path short-circuits in
  // SubAgentManager.run before AgentLoop is constructed.
  "audit-worker": [],
  "testgaps-worker": [],
  // v0.8.0 Phase 5: curator worker runs the CurationLoop directly; the empty
  // scope marks it as deterministic-only.
  "curator-worker": [],
  // v0.9.0 Phase 2.5: reflect worker runs the ReflectJob directly.
  "reflect-worker": [],
};

/**
 * Creates and runs isolated sub-agents with scoped tools and ephemeral conversations.
 * Each sub-agent gets its own ConversationManager and AgentLoop; the conversation
 * is discarded after the run completes.
 *
 * Phase 4 (v0.6.0) sub-task 4.6: implements `SubAgentSpawner`. AgentLoop now
 * imports only that interface, breaking the bidirectional cycle that
 * previously existed between this module and `tools/AgentLoop`.
 */
export class SubAgentManager implements SubAgentSpawner {
  private readonly _promptBuilder: PromptBuilder;

  /**
   * v0.7.0 Phase 7 -- injectable runner for the audit/testgaps workers.
   * Tests replace this with a fake; production callers leave it null so the
   * workers default to `child_process.spawn`.
   */
  private _workerRunner: WorkerCommandRunner | null = null;

  /**
   * v0.8.0 Phase 5 sub-task 5.2 -- the curator worker delegates to a
   * CurationLoop. Set via `setCurationLoop`; null disables curator dispatch.
   */
  private _curationLoop: CurationLoop | null = null;

  /**
   * v0.9.0 Phase 2.5 -- the reflect worker delegates to a ReflectJob.
   * Set via `setReflectJob`; null disables reflect dispatch.
   */
  private _reflectJob: ReflectJob | null = null;

  /** v0.9.0 Phase 2.5 -- cadence cursor for reflect worker (in-memory). */
  private _reflectCadence: ReflectWorkerCadenceState = { lastRunAt: 0 };

  /** v0.9.0 Phase 2.5 -- caller-supplied override for reflect-worker options. */
  private _reflectOptions: Partial<RunReflectWorkerOptions> | null = null;

  constructor(
    private readonly _client: OllamaClient,
    promptBuilder: PromptBuilder,
    private readonly _memoryStore: MemoryStore | null,
    private readonly _ollamaOptions: OllamaOptions,
    private readonly _modelName: string,
    private readonly _tracer: Tracer = new Tracer(),
    private readonly _specialistLoader: SpecialistLoader | null = null,
  ) {
    this._promptBuilder = promptBuilder;
  }

  /** Override the worker command runner. Used in tests; no-op when null. */
  setWorkerRunner(runner: WorkerCommandRunner | null): void {
    this._workerRunner = runner;
  }

  /**
   * Inject the CurationLoop used by the curator-worker dispatch. Production
   * callers wire this from `ChatPanelBootstrap`; tests construct an in-memory
   * fake loop and pass it through directly.
   */
  setCurationLoop(loop: CurationLoop | null): void {
    this._curationLoop = loop;
  }

  /**
   * v0.9.0 Phase 2.5 -- inject the ReflectJob used by the reflect-worker
   * dispatch. Production callers wire this from `ChatPanelBootstrap` when
   * the hardware tier supports lesson generation.
   */
  setReflectJob(job: ReflectJob | null): void {
    this._reflectJob = job;
  }

  /** v0.9.0 Phase 2.5 -- override the reflect-worker cadence / tier options. */
  setReflectWorkerOptions(opts: Partial<RunReflectWorkerOptions> | null): void {
    this._reflectOptions = opts;
  }

  async run(config: SubAgentConfig, postMessage: PostMessageFn, parentTraceId?: string, parentSpanId?: string): Promise<SubAgentResult> {
    const tracer = this._tracer;
    const traceId = parentTraceId || tracer.startTrace();
    const subAgentSpanId = tracer.startSpan(
      traceId,
      `sub_agent_${config.type}`,
      "sub_agent",
      parentSpanId,
      { agentType: config.type, maxIterations: config.maxIterations },
    );

    postMessage({
      type: "subAgentStatus",
      agentType: config.type,
      state: "running",
    });

    // v0.7.0 Phase 7 (C34): worker types run deterministic CLI commands; they
    // do not go through PromptBuilder / AgentLoop / ConversationManager.
    // v0.8.0 Phase 5 (D6/D7): `curator-worker` joins the deterministic branch.
    // v0.9.0 Phase 2.5: `reflect-worker` joins the deterministic branch.
    if (
      config.type === "audit-worker" ||
      config.type === "testgaps-worker" ||
      config.type === "curator-worker" ||
      config.type === "reflect-worker"
    ) {
      return this._runWorker(config, postMessage, subAgentSpanId);
    }

    try {
      // Resolve specialist definition via the priority chain:
      // workspace override -> bundled assets -> hardcoded fallback. When no
      // SpecialistLoader is wired, fall back to the static TOOLS_BY_TYPE map
      // to preserve byte-equivalent behavior with pre-Phase-8 callers.
      const specialist: Specialist | null = this._specialistLoader
        ? await this._specialistLoader.load(config.type)
        : null;

      // Build a scoped tool registry with only the allowed tools.
      const registry = this._buildScopedRegistry(config.type, specialist);

      // Get enabled tool metadata for prompt building.
      const allowedNames = new Set(
        specialist ? specialist.toolScope : TOOLS_BY_TYPE[config.type],
      );
      const allToolMeta = TOOL_CATALOG.map(toDynamicMetadata);
      const scopedToolMeta = allToolMeta.filter((t) => allowedNames.has(t.name));

      // Apply activation rules as a safety layer.
      const { disabledTools } = computeToolActivation(scopedToolMeta, {
        ollamaReachable: true,
        networkAvailable: true,
        readOnlySession: false,
        subAgentType: config.type === "planning" ? null : config.type as "verification" | "research",
        totalToolCount: scopedToolMeta.length,
      });

      const enabledToolMeta = scopedToolMeta.filter((t) => !disabledTools.has(t.name));
      for (const tool of scopedToolMeta) {
        registry.setEnabled(tool.name, !disabledTools.has(tool.name));
      }

      // Build the sub-agent system prompt (minimal: base + tools + sub-agent directive).
      // Use the configured num_ctx (tier-aware via settings.maxTokens) instead of
      // a hardcoded Tier-2 default (review finding #103).
      const systemPrompt = this._promptBuilder.buildForSubAgent(
        config,
        enabledToolMeta,
        this._ollamaOptions.num_ctx ?? 131072,
      );

      // Create an isolated ConversationManager (no persistence store).
      const manager = new ConversationManager(systemPrompt);

      // Inject the context as the first user message.
      const contextMessage = buildSubAgentContextMessage(config);
      manager.addUserMessage(contextMessage);

      // Build Ollama tool definitions from enabled tools.
      const ollamaTools = this._buildOllamaTools(enabledToolMeta);

      // Create and run an isolated AgentLoop.
      let toolCallCount = 0;
      let hadError = false;
      let errorText = "";
      const trackingPostMessage: PostMessageFn = (msg) => {
        if (msg.type === "toolUse") {
          toolCallCount++;
        }
        if (msg.type === "error") {
          hadError = true;
          errorText = (msg as { type: "error"; text: string }).text;
        }
        // Forward status-relevant messages but suppress token streaming.
        if (msg.type === "toolUse" || msg.type === "toolResult" || msg.type === "error") {
          postMessage(msg);
        }
      };

      const agentLoop = new AgentLoop(
        this._client,
        manager,
        registry,
        this._modelName,
        config.maxIterations,
        undefined, // no compactor
        this._ollamaOptions,
        ollamaTools,
        {
          toolCallSource: "sub-agent",
          // v0.8.0 Phase 2 (item C8): sub-agents (verification, research,
          // planning, audit-worker, testgaps-worker) are themselves the
          // verification surface; gating their own loop on a nested
          // verification tool call would deadlock. The parent loop still
          // enforces the gate on the user-visible session.
          passStateGating: false,
        },
      );

      await agentLoop.run(trackingPostMessage);

      // Extract the final assistant message as the sub-agent's output.
      const history = manager.getHistory();
      const lastAssistant = [...history]
        .reverse()
        .find((m) => m.role === "assistant");
      const output = lastAssistant?.content ?? "";

      // Count iterations from history (each assistant message is one iteration).
      const iterationsUsed = history.filter((m) => m.role === "assistant").length;

      const success = !hadError && output.length > 0;

      postMessage({
        type: "subAgentStatus",
        agentType: config.type,
        state: success ? "complete" : "error",
        summary: success ? output.slice(0, 200) : (errorText || "No output from sub-agent"),
      });

      // Clean up the isolated manager.
      manager.dispose();

      tracer.endSpan(subAgentSpanId, success ? "ok" : "error", {
        success,
        toolCallCount,
        iterationsUsed,
        outputLength: output.length,
      });

      return {
        type: config.type,
        success,
        output,
        toolCallCount,
        iterationsUsed,
        error: hadError ? errorText : undefined,
      };
    } catch (err) {
      const errorMessage = formatForUser(err);

      tracer.endSpan(subAgentSpanId, "error", { error: errorMessage });

      postMessage({
        type: "subAgentStatus",
        agentType: config.type,
        state: "error",
        summary: errorMessage.slice(0, 200),
      });

      return {
        type: config.type,
        success: false,
        output: "",
        toolCallCount: 0,
        iterationsUsed: 0,
        error: errorMessage,
      };
    }
  }

  /**
   * Build a fresh ToolRegistry with only the tools allowed for the given sub-agent type.
   * Read-only tools are instantiated without a ConfirmationGate.
   * For verification's run_terminal, a no-op gate with "never" mode is used.
   * When a Specialist is provided, its toolScope drives allowed tools;
   * otherwise the legacy hardcoded TOOLS_BY_TYPE map is used.
   */
  private _buildScopedRegistry(type: SubAgentType, specialist: Specialist | null = null): ToolRegistry {
    const registry = new ToolRegistry();
    const allowed = new Set<string>(specialist ? specialist.toolScope : TOOLS_BY_TYPE[type]);

    if (allowed.has("read_file")) {
      registry.register("read_file", new ReadFileTool());
    }
    if (allowed.has("list_directory")) {
      registry.register("list_directory", new ListDirectoryTool());
    }
    if (allowed.has("grep_codebase")) {
      registry.register("grep_codebase", new GrepCodebaseTool());
    }
    if (allowed.has("run_terminal")) {
      registry.register("run_terminal", new RunTerminalTool());
    }
    if (allowed.has("web_search")) {
      registry.register("web_search", new WebSearchTool());
    }
    if (allowed.has("fetch_page")) {
      registry.register("fetch_page", new FetchPageTool());
    }

    return registry;
  }

  /**
   * v0.7.0 Phase 7 (C34) -- worker dispatch. Spawns the external CLI via
   * `BackgroundWorkers` (audit -> `gemma-check --json`, testgaps -> `vitest
   * --coverage --reporter=json`), formats the output as a chat message, and
   * returns a SubAgentResult with the chat-ready text in `output`.
   *
   * The runner is injectable; production calls leave it null so workers
   * default to `child_process.spawn`. The trace span is closed here so the
   * worker shows up alongside verification/research in the trace dashboard.
   */
  private async _runWorker(
    config: SubAgentConfig,
    postMessage: PostMessageFn,
    spanId: string,
  ): Promise<SubAgentResult> {
    const tracer = this._tracer;
    try {
      const runnerOpts = this._workerRunner ? { runner: this._workerRunner } : {};
      const result = config.type === "audit-worker"
        ? await runAuditWorker(config.modifiedFiles, runnerOpts)
        : config.type === "testgaps-worker"
        ? await runTestgapsWorker(config.modifiedFiles, runnerOpts)
        : config.type === "curator-worker"
        ? await runCuratorWorker(this._curationLoop)
        : await runReflectWorker(this._reflectJob, {
            cadence: {
              read: () => this._reflectCadence,
              write: (s) => { this._reflectCadence = s; },
            },
            ...(this._reflectOptions ?? {}),
          });

      const status: "complete" | "error" = result.success ? "complete" : "error";
      postMessage({
        type: "subAgentStatus",
        agentType: config.type,
        state: status,
        summary: (result.error ?? result.output).slice(0, 200),
      });

      tracer.endSpan(spanId, result.success ? "ok" : "error", {
        success: result.success,
        toolCallCount: result.toolCallCount,
        outputLength: result.output.length,
      });

      return {
        type: config.type,
        success: result.success,
        output: result.output,
        toolCallCount: result.toolCallCount,
        iterationsUsed: 0,
        error: result.error,
      };
    } catch (err) {
      const errorMessage = formatForUser(err);
      tracer.endSpan(spanId, "error", { error: errorMessage });
      postMessage({
        type: "subAgentStatus",
        agentType: config.type,
        state: "error",
        summary: errorMessage.slice(0, 200),
      });
      return {
        type: config.type,
        success: false,
        output: "",
        toolCallCount: 0,
        iterationsUsed: 0,
        error: errorMessage,
      };
    }
  }

  private _buildOllamaTools(tools: readonly DynamicToolMetadata[]): OllamaToolDefinition[] {
    return tools.map((tool) => {
      const properties: Record<string, { type: string; description: string }> = {};
      const required: string[] = [];
      for (const [key, param] of Object.entries(tool.parameters)) {
        properties[key] = { type: param.type, description: param.description };
        if (param.required) {
          required.push(key);
        }
      }
      return {
        type: "function" as const,
        function: {
          name: tool.name,
          description: tool.description,
          parameters: {
            type: "object",
            properties,
            ...(required.length > 0 ? { required } : {}),
          },
        },
      };
    });
  }
}
