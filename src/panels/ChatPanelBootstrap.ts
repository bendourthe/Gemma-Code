import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { parsePermissionsDeny } from "../../core/storage/PermissionsDeny.js";
import { createHookBus } from "../../core/lifecycle/HookBus.js";
import { attachSessionReflectionHook } from "../../core/lifecycle/SessionReflectionHook.js";
import { attachPreCompactWipHook } from "../../core/lifecycle/PreCompactHook.js";
import { matchPathScope } from "../../core/skills/SkillCatalog.js";
import { createCredentialVault } from "../../core/security/CredentialVault.js";
import type { PathScopedSkillSource } from "../tools/AgentLoop.js";
import { ConversationManager } from "../../modules/coding/chat/ConversationManager.js";
import type { ContextCompactor } from "../../modules/coding/chat/ContextCompactor.js";
import { CompressionState } from "../../modules/coding/chat/state/CompressionState.js";
import type { StreamingPipeline } from "../../modules/coding/chat/StreamingPipeline.js";
import { PlanMode } from "../../modules/coding/chat/PlanMode.js";
import { PromptBuilder } from "../../modules/coding/chat/PromptBuilder.js";
import { CommandRouter } from "../../modules/coding/commands/CommandRouter.js";
import { SkillLoader } from "../../modules/coding/skills/SkillLoader.js";
import { SkillMetrics } from "../../modules/coding/skills/SkillMetrics.js";
import { CurationLoop, makeStaticInputs } from "../../modules/coding/skills/CurationLoop.js";
import { McpManager } from "../../modules/coding/mcp/McpManager.js";
import { McpServer } from "../../modules/coding/mcp/McpServer.js";
import {
  ChatController,
  buildOllamaTuning,
} from "./ChatController.js";
import { ChatStatusReporter } from "./ChatStatusReporter.js";
import { ChatMessageRouter } from "./ChatMessageRouter.js";
import { ToolActivationContext } from "./ToolActivationContext.js";
import {
  initStore,
  initToolOutputCache,
  initWebResponseCache,
  initOperationLog,
  buildMemorySubsystem,
  buildMemoryFiles,
} from "./ChatPanelInit.js";
import type { ChatHistoryStore } from "../storage/ChatHistoryStore.js";
import type { MemoryStore } from "../storage/MemoryStore.js";
import type { MemorySubsystem } from "../storage/MemorySubsystem.js";
import type { MemoryFiles } from "../storage/MemoryFiles.js";
import { MemorySnapshot } from "../storage/MemorySnapshot.js";
import { PlanArchive } from "../storage/PlanArchive.js";
import type { ToolOutputCache } from "../storage/ToolOutputCache.js";
import type { WebResponseCache } from "../tools/handlers/webCache.js";
import type { OperationLog } from "../../modules/coding/observability/OperationLog.js";
import type { WorkingMemory } from "../storage/WorkingMemory.js";
import type { EpisodicMemory } from "../storage/EpisodicMemory.js";
import type { GraphMemory } from "../storage/GraphMemory.js";
import type { MemoryConsolidator } from "../storage/MemoryConsolidator.js";
import type { UnifiedMemoryRetriever } from "../storage/UnifiedMemoryRetriever.js";
import type { GemmaCodeSettings } from "../../modules/coding/config/settings.js";
import { TOOL_CATALOG } from "../tools/ToolCatalog.js";
import type { DynamicToolMetadata } from "../tools/ToolCatalog.js";
import type { HardwareTierConfig } from "../../modules/coding/config/HardwareTier.types.js";
import { getTierConfig } from "../../modules/coding/config/HardwareTier.js";
import { GitSafetyNet } from "../../modules/coding/guardrails/GitSafetyNet.js";
import type { Orchestrator } from "../../modules/coding/orchestration/Orchestrator.js";
import type { SubAgentManager } from "../../modules/coding/agents/SubAgentManager.js";
import { WorktreeManager } from "../../modules/coding/agents/WorktreeManager.js";
import type { AgentLoop } from "../tools/AgentLoop.js";
import { ConfirmationGate } from "../tools/ConfirmationGate.js";
import { defaultPermissionOptions } from "./webview/render/permissionPrompt.js";
import type { ToolRegistry } from "../tools/ToolRegistry.js";
import { buildToolRegistry } from "../tools/ToolRegistryBuilder.js";
import { TodoState } from "../tools/handlers/todos.js";
import { renderMarkdown } from "../../modules/coding/utils/MarkdownRenderer.js";
import { getLogger } from "../../modules/coding/utils/logger.js";
import type { NexusCodingRuntime } from "../../modules/coding/runtime/NexusCodingRuntime.js";
import type { EditMode } from "../tools/types.js";
import type {
  WebviewToExtensionMessage,
  ExtensionToWebviewMessage,
} from "./messages.js";

/**
 * Late-binding hooks the panel exposes to the bootstrap so the helper graphs
 * see live mutable state (settings cache, mcp tools, edit mode, ollama
 * reachability, hardware tier). Extracted as part of v0.7.0 Phase 0
 * sub-task 0.4 so {@link NexusCodingPanel} no longer carries the wiring
 * graph as constructor body.
 */
export interface ChatPanelHooks {
  getSettings(): GemmaCodeSettings;
  invalidateSettingsCache(): void;
  getMcpTools(): DynamicToolMetadata[];
  setMcpTools(tools: DynamicToolMetadata[]): void;
  getCurrentEditMode(): EditMode;
  setCurrentEditMode(mode: EditMode): void;
  getOllamaReachable(): boolean;
  getTierConfig(): HardwareTierConfig | undefined;
  getOutputChannel(): vscode.OutputChannel;
  postRaw(msg: ExtensionToWebviewMessage): void;
  handleWebviewMessage(msg: WebviewToExtensionMessage): Promise<void>;
}

export interface ChatPanelBootstrapInput {
  readonly extensionUri: vscode.Uri;
  readonly runtime: NexusCodingRuntime;
  readonly globalStorageUri?: vscode.Uri;
  readonly workspaceState?: vscode.Memento;
  readonly hooks: ChatPanelHooks;
  readonly hostPostMessage: (msg: ExtensionToWebviewMessage) => void;
}

export interface BootstrappedPanel {
  readonly settings: GemmaCodeSettings;
  readonly store: ChatHistoryStore | null;
  readonly toolOutputCache: ToolOutputCache | null;
  readonly webResponseCache: WebResponseCache | null;
  readonly operationLog: OperationLog | null;
  readonly memorySubsystem: MemorySubsystem;
  readonly memoryStore: MemoryStore | null;
  readonly workingMemory: WorkingMemory | null;
  readonly episodicMemory: EpisodicMemory | null;
  readonly graphMemory: GraphMemory | null;
  readonly unifiedRetriever: UnifiedMemoryRetriever | null;
  readonly memoryConsolidator: MemoryConsolidator | null;
  readonly memoryFiles: MemoryFiles | null;
  readonly planMode: PlanMode;
  readonly planArchive: PlanArchive;
  readonly promptBuilder: PromptBuilder;
  readonly toolActivation: ToolActivationContext;
  readonly manager: ConversationManager;
  readonly confirmationGate: ConfirmationGate;
  readonly registry: ToolRegistry;
  readonly compactor: ContextCompactor;
  readonly subAgentManager: SubAgentManager;
  readonly gitSafetyNet: GitSafetyNet | null;
  readonly orchestrator: Orchestrator;
  readonly agentLoop: AgentLoop;
  readonly pipeline: StreamingPipeline;
  readonly skillLoader: SkillLoader;
  readonly skillMetrics: SkillMetrics;
  readonly curationLoop: CurationLoop;
  readonly commandRouter: CommandRouter;
  readonly statusReporter: ChatStatusReporter;
  readonly controller: ChatController;
  readonly messageRouter: ChatMessageRouter;
  readonly mcpManager: McpManager | null;
  readonly mcpServer: McpServer | null;
}

/**
 * Build the entire chat-panel construction graph. The panel owns lifecycle
 * (resolveWebviewView, dispose, settings change subscription) and exposes
 * mutable state via {@link ChatPanelHooks}; everything else lives in
 * helper modules ({@link ChatStatusReporter}, {@link ChatMessageRouter},
 * {@link ToolActivationContext}, {@link ChatPanelInit}, the static
 * factories on {@link ChatController}).
 */
export function bootstrapChatPanel(input: ChatPanelBootstrapInput): BootstrappedPanel {
  const { extensionUri, runtime, globalStorageUri, workspaceState, hooks } = input;
  const settings = hooks.getSettings();

  const store = initStore(globalStorageUri);
  const toolOutputCache = initToolOutputCache(settings);
  const webResponseCache = initWebResponseCache();
  const operationLog = initOperationLog(settings);

  const client = runtime.getOllamaClient();

  const memorySubsystem = buildMemorySubsystem(
    settings,
    client,
    toolOutputCache,
    globalStorageUri,
  );

  // v0.7.0 Phase 2: file-backed memory (Instructions/Memory/Context) lives
  // under ~/.nexus/memory/<workspace-id>/. Constructed before
  // PromptBuilder so the read result is wired into every prompt build.
  const memoryFiles = buildMemoryFiles(settings);

  // v0.8.0 Phase 2 (item A1): capture an immutable snapshot of the three
  // memory files at session start. `frozen` mode (default) keeps the
  // rendered prompt byte-stable for the lifetime of the session so the
  // LLM prefix cache survives mid-session writes; `live` mode preserves
  // the v0.7.0 behaviour of re-reading on every build.
  const memorySnapshot = memoryFiles
    ? MemorySnapshot.captureAtSessionStart(
        memoryFiles.workspaceId,
        memoryFiles,
        settings.memorySnapshotMode,
      )
    : null;

  const planMode = new PlanMode();
  const promptBuilder = new PromptBuilder(memoryFiles, memorySnapshot);

  // v0.8.0 Phase 3.2 (item A8): persistent plan-version archive. Reuses the
  // memory-file workspace id so the archive sits under
  // `~/.nexus/plans/<workspace>/` next to the memory files. Falling back
  // to `default` when no workspace is loaded preserves the local-only path.
  const planArchive = new PlanArchive({
    workspaceId: memoryFiles?.workspaceId,
  });

  // The ToolActivation reads late-binding state via callbacks so prompt
  // rebuilds reflect the latest mcpTools, settings, ollama reachability and
  // tier config without a full panel reconstruction.
  let registry: ToolRegistry | null = null;
  const toolActivation = new ToolActivationContext({
    planMode,
    getSettings: () => hooks.getSettings(),
    getRegistry: () => registry,
    getMcpTools: () => hooks.getMcpTools(),
    getOllamaReachable: () => hooks.getOllamaReachable(),
    getTierConfig: () => hooks.getTierConfig(),
    getWorkingMemory: () => memorySubsystem.workingMemory,
    getUnifiedRetriever: () => memorySubsystem.unifiedRetriever,
  });

  const initialPrompt = promptBuilder.buildSync(toolActivation.buildPromptContext());
  const manager = new ConversationManager(initialPrompt, store ?? undefined);

  const postWithRender = (msg: ExtensionToWebviewMessage): void => {
    if (msg.type === "messageComplete" && !msg.renderedHtml) {
      const history = manager.getHistory();
      const found = history.find((m) => m.id === msg.messageId);
      input.hostPostMessage({
        ...msg,
        renderedHtml: found ? renderMarkdown(found.content) : "",
      });
      return;
    }
    input.hostPostMessage(msg);
  };

  const confirmationGate = new ConfirmationGate(postWithRender, defaultPermissionOptions);

  // v0.7.0 Phase 3: per-session CompressionState owns block IDs and runs.
  const compressionState = new CompressionState();

  // v0.7.0 Phase 4.4 / v0.8.0 Phase 0.5 (closes 10.O.3): per-session TodoState
  // holds the latest published todo list; the `update_todos` tool reads it and
  // the completion-report renderer (Phase 4.7) consumes the latest snapshot.
  const todoState = new TodoState();

  // v1.4.0 Phase 8 (gap 5.3.P2.R): load the operator `.nexus/permissions.deny`
  // file (if present) so the registry can refuse write-capable tool calls whose
  // subject matches a deny rule. Missing file -> undefined -> deny-gating off.
  const denyRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  let permissionsDeny;
  if (denyRoot) {
    try {
      permissionsDeny = parsePermissionsDeny(
        fs.readFileSync(path.join(denyRoot, ".nexus", "permissions.deny"), "utf-8"),
      );
    } catch {
      // No deny file (or unreadable) -- leave deny-gating off.
    }
  }

  registry = buildToolRegistry({
    gate: confirmationGate,
    editMode: settings.editMode,
    secretPathDenyExtra: settings.secretPathDenyExtra,
    permissionOverrides: settings.permissionOverrides,
    toolOutputCache,
    webResponseCache,
    permissionsDeny,
    compress: {
      deps: {
        conversation: manager,
        state: compressionState,
        protectedTools: settings.compactionProtectedTools,
        protectUserMessages: false,
      },
      experimentalMessageMode: settings.compactExperimentalMessageMode,
    },
    todos: {
      state: todoState,
      post: input.hostPostMessage,
    },
  });

  const ollamaOptions = buildOllamaTuning(settings);
  const ollamaTools = toolActivation.buildOllamaTools();

  const compactor = ChatController.buildContextCompactor({
    manager,
    client,
    settings,
    ollamaOptions,
    memoryStore: memorySubsystem.memoryStore,
    memoryConsolidator: memorySubsystem.memoryConsolidator,
    tracer: runtime.tracer,
    getSettings: () => runtime.settings,
  });

  const subAgentManager = ChatController.buildSubAgentManager({
    client,
    promptBuilder,
    memoryStore: memorySubsystem.memoryStore,
    ollamaOptions,
    modelName: settings.modelName,
    tracer: runtime.tracer,
  });

  const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const gitSafetyNet = workspacePath ? new GitSafetyNet(workspacePath) : null;

  // v1.5.0 Phase 4 (T010, closes v1.4.0 T018.P3.A): live-wire worktree isolation
  // into the sub-agent dispatch path. With this set, a sub-agent dispatched with
  // `isolate: true` (the DAGExecutor sets it for write-capable swarm nodes) runs
  // its file-mutating tool calls in a dedicated detached git worktree. Degrades
  // gracefully to the shared workspace when the workspace is not a git repo.
  if (workspacePath) {
    subAgentManager.setWorktreeManager(new WorktreeManager(workspacePath));
  }

  const initialTier = getTierConfig(settings.gpuTierOverride ?? 2);

  const orchestrator = ChatController.buildOrchestrator({
    client,
    modelName: settings.modelName,
    ollamaOptions,
    subAgentManager,
    hardwareTier: initialTier,
    memoryStore: memorySubsystem.memoryStore,
    postMessage: input.hostPostMessage,
    // v1.5.0 Phase 4 (item 36, T011): opt-in planner/critic/worker swarm.
    swarmEnabled: settings.swarmOrchestrationEnabled,
  });

  const extensionFsPath = extensionUri.fsPath ?? "";
  const catalogDir = path.join(extensionFsPath, "modules", "coding", "skills", "catalog");
  const skillLoader = new SkillLoader(catalogDir);
  skillLoader.load();
  skillLoader.watch();

  // v1.4.0 Phase 8 (gap 5.4.P3.T): a single in-process lifecycle bus per
  // session. The reflection hook subscribes here; AgentLoop emits
  // `lifecycle.session.reflection` at session end (see AgentLoop._emitSessionStop),
  // so the hook drafts <nexusHome>/reflections/<sessionId>.md for human review.
  const hookBus = createHookBus();
  attachSessionReflectionHook(hookBus);

  // v1.5.0 Phase 4 (T013, closes v1.4.0 T016.P3.A): now that a session HookBus
  // exists, attach the A8 PreCompact WIP hook alongside the reflection hook and
  // wire the same bus into the ContextCompactor, which emits
  // `lifecycle.context.preCompact` at the real compaction boundary. The hook
  // then detects uncommitted edits, persists a restorable checkpoint, and warns
  // (non-blocking) before the compaction buries in-flight work. The git probe is
  // rooted at the workspace so it sees the right working tree.
  attachPreCompactWipHook(hookBus, workspacePath ? { cwd: workspacePath } : {});
  compactor.setHookBus(hookBus);

  // v1.4.0 Phase 8 (gap 5.2.P3.Q): a path-scoped skill source backed by the
  // SkillLoader. AgentLoop calls reevaluatePathScope at the start of each run
  // (via activeEditPathProvider) so path-scoped skills activate / deactivate as
  // the editing focus changes. Skills with no `pathScope` frontmatter stay
  // global. Provenance is reported as `user` (the loader's user/catalog dirs).
  const skillCatalog: PathScopedSkillSource = {
    reevaluatePathScope(currentPath) {
      return skillLoader
        .listSkills()
        .filter((s) => matchPathScope(s.metadata.pathScope, currentPath))
        .map((s) => ({ id: s.name, provenance: { source: "user" as const } }));
    },
  };
  const activeEditPathProvider = (): string | null => {
    const editorPath = vscode.window.activeTextEditor?.document.uri.fsPath;
    if (!editorPath || !workspacePath) return null;
    const rel = path.relative(workspacePath, editorPath);
    if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
    return rel.replace(/\\/g, "/");
  };

  const agentLoop = ChatController.buildAgentLoop({
    client,
    manager,
    registry,
    modelName: settings.modelName,
    maxIterations: initialTier.maxAgentIterations,
    compactor,
    ollamaOptions,
    ollamaTools,
    subAgentManager,
    settings,
    workingMemory: memorySubsystem.workingMemory,
    episodicMemory: memorySubsystem.episodicMemory,
    gitSafetyNet,
    tracer: runtime.tracer,
    operationLog,
    hookBus,
    skillCatalog,
    activeEditPathProvider,
  });

  const pipeline = ChatController.buildStreamingPipeline({
    client,
    manager,
    modelName: settings.modelName,
    agentLoop,
    ollamaOptions,
    ollamaTools,
  });

  // v0.8.0 Phase 5 sub-task 5.1: per-skill rolling 30-day metrics. The recorder
  // emits Tracer events tagged `skill.<name>.<outcome>` so trace dashboards
  // pick up the same data.
  const skillMetrics = new SkillMetrics(undefined, runtime.tracer);

  // v0.8.0 Phase 5 sub-task 5.2: dual-loop curator. Inputs are wired to the
  // SkillLoader + bundled catalog directory; the memory-deduplication probe is
  // left as an empty list until the MemoryStore.searchHybrid round-trip lands
  // in v0.9.0 (the curator surface ships now without a dedup source so the
  // dry-run path still emits stale-skill and patch-frontmatter proposals).
  const curationLoop = new CurationLoop(
    skillMetrics,
    makeStaticInputs({
      skills: skillLoader.listSkills().map((s) => s.name),
      resolveSkillSkillMdPath: (name) => path.join(catalogDir, name, "SKILL.md"),
    }),
    undefined,
    settings.curatorWorkerEnabled,
  );
  subAgentManager.setCurationLoop(curationLoop);

  const commandRouter = new CommandRouter(() =>
    skillLoader.listSkills().map((s) => ({
      name: s.name,
      description: s.description,
      argumentHint: s.argumentHint || undefined,
    })),
  );

  const statusReporter = new ChatStatusReporter({
    manager,
    compactor,
    getSettings: () => hooks.getSettings(),
    getMemoryStore: () => memorySubsystem.memoryStore,
    getMcpManager: () => mcpManager,
    getMcpTools: () => hooks.getMcpTools(),
    postMessage: input.hostPostMessage,
  });

  const controller = new ChatController({
    manager,
    planMode,
    promptBuilder,
    compactor,
    commandRouter,
    runtime,
    subAgentManager,
    agentLoop,
    pipeline,
    orchestrator,
    skillLoader,
    planArchive,
    getStore: () => store,
    getMemoryStore: () => memorySubsystem.memoryStore,
    getMemoryFiles: () => memoryFiles,
    getToolOutputCache: () => toolOutputCache,
    getOperationLog: () => operationLog,
    getCompressionState: () => compressionState,
    getMcpManager: () => mcpManager,
    getMcpTools: () => hooks.getMcpTools(),
    setMcpTools: (tools) => hooks.setMcpTools(tools),
    getUnifiedRetriever: () => memorySubsystem.unifiedRetriever,
    getSettings: () => hooks.getSettings(),
    getSkillMetrics: () => skillMetrics,
    getCurationLoop: () => curationLoop,
    buildPromptContext: (memoryContext) =>
      toolActivation.buildPromptContext(memoryContext),
    postMessage: input.hostPostMessage,
    postHistory: () => statusReporter.postHistory(),
    postTokenCount: () => statusReporter.postTokenCount(),
    postMemoryStatus: () => statusReporter.postMemoryStatus(),
    postMcpStatus: () => statusReporter.postMcpStatus(),
  });

  const messageRouter = new ChatMessageRouter({
    controller,
    status: statusReporter,
    manager,
    planMode,
    promptBuilder,
    commandRouter,
    confirmationGate,
    agentLoop,
    gitSafetyNet,
    getSettings: () => hooks.getSettings(),
    getCurrentEditMode: () => hooks.getCurrentEditMode(),
    setCurrentEditMode: (mode) => hooks.setCurrentEditMode(mode),
    buildPromptContext: (memoryContext) =>
      toolActivation.buildPromptContext(memoryContext),
    postMessage: input.hostPostMessage,
    getOutputChannel: () => hooks.getOutputChannel(),
  });

  // MCP wiring: the McpManager is constructed when enabled, and its async
  // initialize() is fired-and-forgotten. McpServer is started when stdio
  // mode is selected.
  let mcpManager: McpManager | null = null;
  let mcpServer: McpServer | null = null;
  if (settings.mcpEnabled) {
    // v1.5.0 Phase 1 (T002) -- wire the OS-keychain credential vault as the
    // source for `${vault}` env references so MCP secrets never read from
    // plaintext mcp.json. The vault logger only ever receives redacted text.
    const credentialVault = createCredentialVault({
      logger: (level, message) => {
        const log = getLogger();
        if (level === "error") log.error(message);
        else if (level === "warn") log.warn(message);
        else log.debug(message);
      },
    });
    mcpManager = new McpManager(
      registry,
      workspacePath,
      workspaceState,
      undefined,
      credentialVault,
    );
    void mcpManager
      .initialize()
      .then(() => {
        const tools = mcpManager?.getAllToolMetadata() ?? [];
        hooks.setMcpTools(tools);
        const prompt = promptBuilder.build(toolActivation.buildPromptContext());
        manager.rebuildSystemPrompt(prompt);
      })
      .catch((err) => {
        getLogger().warn("[McpManager] Initialization failed:", err);
      });
  }
  if (settings.mcpServerMode === "stdio") {
    mcpServer = new McpServer(registry, TOOL_CATALOG, settings.mcpExposedTools);
    void mcpServer.start().catch((err) => {
      getLogger().warn("[McpServer] Failed to start:", err);
    });
  }

  return {
    settings,
    store,
    toolOutputCache,
    webResponseCache,
    operationLog,
    memorySubsystem,
    memoryStore: memorySubsystem.memoryStore,
    workingMemory: memorySubsystem.workingMemory,
    episodicMemory: memorySubsystem.episodicMemory,
    graphMemory: memorySubsystem.graphMemory,
    unifiedRetriever: memorySubsystem.unifiedRetriever,
    memoryConsolidator: memorySubsystem.memoryConsolidator,
    memoryFiles,
    planMode,
    planArchive,
    promptBuilder,
    toolActivation,
    manager,
    confirmationGate,
    registry,
    compactor,
    subAgentManager,
    gitSafetyNet,
    orchestrator,
    agentLoop,
    pipeline,
    skillLoader,
    skillMetrics,
    curationLoop,
    commandRouter,
    statusReporter,
    controller,
    messageRouter,
    mcpManager,
    mcpServer,
  };
}
