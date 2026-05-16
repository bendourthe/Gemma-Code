import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockOf } from "../../helpers/factories.js";
import type { ChatCommandContext } from "../../../src/panels/ChatCommandHandlers.js";
import {
  ChatCommandHandlers,
  parseForgetArgs,
  parseImportArgs,
  forgetMatchingSqlRows,
} from "../../../src/panels/ChatCommandHandlers.js";
import type { ExtensionToWebviewMessage } from "../../../src/panels/messages.js";

vi.mock("vscode", () => ({
  workspace: {
    workspaceFolders: [{ uri: { fsPath: "/ws" } }],
    getConfiguration: vi.fn(() => ({
      update: vi.fn().mockResolvedValue(undefined),
    })),
    openTextDocument: vi.fn().mockResolvedValue({ uri: { fsPath: "/ws/Memory.md" } }),
  },
  window: {
    showQuickPick: vi.fn(),
    showTextDocument: vi.fn().mockResolvedValue(undefined),
  },
  Uri: { file: (p: string) => ({ fsPath: p }) },
  ConfigurationTarget: { Global: 1 },
}));

vi.mock("../../../src/utils/MarkdownRenderer.js", () => ({
  renderMarkdown: (s: string) => `<rendered>${s}</rendered>`,
}));

vi.mock("../../../src/commands/memoryLintCommand.js", () => ({
  parseMemoryLintArgs: vi.fn(() => ({ apply: false, full: false, limit: 100 })),
  runMemoryLint: vi.fn().mockResolvedValue({ message: "_lint ok_", fixed: 0 }),
}));

interface PostedMessage {
  msg: ExtensionToWebviewMessage;
}

interface FakeContextOptions {
  memoryStore?: unknown;
  memoryFiles?: unknown;
  toolOutputCache?: unknown;
  operationLog?: unknown;
  store?: unknown;
  mcpManager?: unknown;
  mcpEnabled?: boolean;
  mcpTools?: unknown[];
}

function makeFakeCtx(opts: FakeContextOptions = {}): {
  ctx: ChatCommandContext;
  posted: PostedMessage[];
  added: string[];
  postHistory: ReturnType<typeof vi.fn>;
  postTokenCount: ReturnType<typeof vi.fn>;
  postMemoryStatus: ReturnType<typeof vi.fn>;
  postMcpStatus: ReturnType<typeof vi.fn>;
} {
  const posted: PostedMessage[] = [];
  const added: string[] = [];
  let assistantId = 0;

  const manager = mockOf<ChatCommandContext["manager"]>({
    addAssistantMessage: vi.fn((content: string) => {
      added.push(content);
      return {
        id: `m${++assistantId}`,
        role: "assistant" as const,
        content,
        timestamp: Date.now(),
      };
    }),
    clearHistory: vi.fn(),
    rebuildSystemPrompt: vi.fn(),
    getHistory: vi.fn(() => []),
    sessionId: "session-1",
  });

  const planMode = mockOf<ChatCommandContext["planMode"]>({
    toggle: vi.fn(() => true),
    resetPlan: vi.fn(),
  });

  const promptBuilder = mockOf<ChatCommandContext["promptBuilder"]>({
    build: vi.fn(() => "system prompt"),
  });

  const compactor = mockOf<ChatCommandContext["compactor"]>({
    // v0.8.0 Phase 6.1: compact() now returns a three-state result; the
    // mock yields the "ok" success path so legacy callers stay green.
    compact: vi.fn().mockResolvedValue({ state: "ok", summary: "test mock" }),
  });

  const commandRouter = mockOf<ChatCommandContext["commandRouter"]>({
    getAllDescriptors: vi.fn(() => [
      { name: "memory", description: "Manage memory" },
      { name: "cache", description: "Manage cache" },
    ]),
  });

  const runtime = mockOf<ChatCommandContext["runtime"]>({
    getOllamaClient: vi.fn(() => ({
      listModels: vi.fn().mockResolvedValue([{ name: "gemma4:e4b" }]),
    })),
  });

  const subAgentManager = mockOf<ChatCommandContext["subAgentManager"]>({
    run: vi.fn().mockResolvedValue({
      type: "verification",
      success: true,
      output: "all good",
      toolCallCount: 0,
      iterationsUsed: 1,
    }),
  });

  const agentLoop = mockOf<ChatCommandContext["agentLoop"]>({
    getModifiedFiles: vi.fn(() => []),
    getRecentToolResults: vi.fn(() => []),
  });

  const postHistory = vi.fn();
  const postTokenCount = vi.fn();
  const postMemoryStatus = vi.fn();
  const postMcpStatus = vi.fn();

  const ctx: ChatCommandContext = {
    manager,
    planMode,
    promptBuilder,
    compactor,
    commandRouter,
    runtime,
    subAgentManager,
    agentLoop,
    getStore: () => opts.store as never,
    getMemoryStore: () => opts.memoryStore as never,
    getMemoryFiles: () => opts.memoryFiles as never,
    getToolOutputCache: () => opts.toolOutputCache as never,
    getOperationLog: () => opts.operationLog as never,
    getMcpManager: () => opts.mcpManager as never,
    getMcpTools: () => (opts.mcpTools ?? []) as never,
    setMcpTools: vi.fn(),
    getSettings: () => ({
      mcpEnabled: opts.mcpEnabled ?? false,
      embeddingModel: "",
      secretPathDenyExtra: [] as readonly string[],
      subAgentMaxIterations: 5,
    }) as never,
    buildPromptContext: vi.fn(() => ({}) as never),
    postMessage: (m: ExtensionToWebviewMessage) => posted.push({ msg: m }),
    postHistory,
    postTokenCount,
    postMemoryStatus,
    postMcpStatus,
  };

  return { ctx, posted, added, postHistory, postTokenCount, postMemoryStatus, postMcpStatus };
}

describe("ChatCommandHandlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("/help posts a markdown message listing commands", async () => {
    const { ctx, posted, added, postHistory } = makeFakeCtx();
    const h = new ChatCommandHandlers(ctx);
    await h.dispatch("help", "");

    expect(added[0]).toContain("Available Commands");
    expect(added[0]).toContain("/memory");
    expect(posted[0]?.msg.type).toBe("messageComplete");
    expect(postHistory).toHaveBeenCalled();
  });

  it("/clear clears history and resets plan", async () => {
    const { ctx, postHistory, postTokenCount } = makeFakeCtx();
    const h = new ChatCommandHandlers(ctx);
    await h.dispatch("clear", "");

    expect(ctx.manager.clearHistory).toHaveBeenCalled();
    expect(ctx.planMode.resetPlan).toHaveBeenCalled();
    expect(postHistory).toHaveBeenCalled();
    expect(postTokenCount).toHaveBeenCalled();
  });

  it("/history with no store falls back to a help message", async () => {
    const { ctx, added } = makeFakeCtx({ store: null });
    const h = new ChatCommandHandlers(ctx);
    await h.dispatch("history", "");

    expect(added[0]).toContain("better-sqlite3");
  });

  it("/history with a store posts a sessionList event", async () => {
    const fakeStore = {
      listSessions: vi.fn(() => [{ id: "s1", title: "x", createdAt: 0, updatedAt: 0, messages: [] }]),
    };
    const { ctx, posted } = makeFakeCtx({ store: fakeStore });
    const h = new ChatCommandHandlers(ctx);
    await h.dispatch("history", "");

    expect(fakeStore.listSessions).toHaveBeenCalledWith(50);
    expect(posted[0]?.msg.type).toBe("sessionList");
  });

  it("/plan toggles plan mode and rebuilds the prompt", async () => {
    const { ctx, posted } = makeFakeCtx();
    const h = new ChatCommandHandlers(ctx);
    await h.dispatch("plan", "");

    expect(ctx.planMode.toggle).toHaveBeenCalled();
    expect(ctx.manager.rebuildSystemPrompt).toHaveBeenCalled();
    expect(posted.some((p) => p.msg.type === "planModeToggled")).toBe(true);
  });

  it("/compact delegates to the compactor and refreshes counters", async () => {
    const { ctx, postHistory, postTokenCount } = makeFakeCtx();
    const h = new ChatCommandHandlers(ctx);
    await h.dispatch("compact", "");

    expect(ctx.compactor.compact).toHaveBeenCalled();
    expect(postTokenCount).toHaveBeenCalled();
    expect(postHistory).toHaveBeenCalled();
  });

  it("/memory with no store reports disabled", async () => {
    const { ctx, added } = makeFakeCtx({ memoryStore: null });
    const h = new ChatCommandHandlers(ctx);
    await h.dispatch("memory", "status");

    expect(added[0]).toContain("Memory system is disabled");
  });

  it("/memory status renders memory stats", async () => {
    const memoryStore = {
      getStats: vi.fn(() => ({
        totalEntries: 7,
        embeddingCount: 3,
        byType: { fact: 7 },
        oldestEntryAt: 0,
        newestEntryAt: 0,
      })),
      searchKeyword: vi.fn(),
      save: vi.fn(),
      clear: vi.fn(),
    };
    const { ctx, added } = makeFakeCtx({ memoryStore });
    const h = new ChatCommandHandlers(ctx);
    await h.dispatch("memory", "status");

    expect(added[0]).toContain("Total entries:** 7");
  });

  it("/memory search rejects empty query", async () => {
    const memoryStore = { searchKeyword: vi.fn(() => []) };
    const { ctx, added } = makeFakeCtx({ memoryStore });
    const h = new ChatCommandHandlers(ctx);
    await h.dispatch("memory", "search");

    expect(added[0]).toContain("Usage:");
    expect(memoryStore.searchKeyword).not.toHaveBeenCalled();
  });

  it("/memory search returns results", async () => {
    const memoryStore = {
      searchKeyword: vi.fn(() => [
        { entry: { type: "fact", content: "cats are cool" }, score: 1 },
      ]),
    };
    const { ctx, added } = makeFakeCtx({ memoryStore });
    const h = new ChatCommandHandlers(ctx);
    await h.dispatch("memory", "search cats");

    expect(memoryStore.searchKeyword).toHaveBeenCalledWith("cats", 10);
    expect(added[0]).toContain("cats are cool");
  });

  it("/memory save persists content and refreshes the badge", async () => {
    const memoryStore = {
      save: vi.fn().mockResolvedValue(undefined),
      getStats: vi.fn(() => ({ totalEntries: 1, embeddingCount: 0, byType: {} })),
    };
    const { ctx, postMemoryStatus } = makeFakeCtx({ memoryStore });
    const h = new ChatCommandHandlers(ctx);
    await h.dispatch("memory", "save the answer is 42");

    expect(memoryStore.save).toHaveBeenCalledWith(
      "the answer is 42",
      "fact",
      "session-1",
    );
    expect(postMemoryStatus).toHaveBeenCalled();
  });

  it("/memory clear empties the store", async () => {
    const memoryStore = {
      clear: vi.fn(),
      getStats: vi.fn(() => ({ totalEntries: 0, embeddingCount: 0, byType: {} })),
    };
    const { ctx } = makeFakeCtx({ memoryStore });
    const h = new ChatCommandHandlers(ctx);
    await h.dispatch("memory", "clear");

    expect(memoryStore.clear).toHaveBeenCalled();
  });

  it("/cache with no cache reports disabled", async () => {
    const { ctx, added } = makeFakeCtx({ toolOutputCache: null });
    const h = new ChatCommandHandlers(ctx);
    await h.dispatch("cache", "");

    expect(added[0]).toContain("Tool-output cache is disabled");
  });

  it("/cache status renders snapshot", async () => {
    const toolOutputCache = {
      stats: vi.fn(() => ({ entries: 4, topByHits: [] })),
      lruStats: vi.fn(() => ({ entries: 0, bytes: 0, hits: 0, misses: 0 })),
      clear: vi.fn(() => 0),
      prune: vi.fn(() => 0),
      reembedHeuristic: vi.fn(),
    };
    const { ctx, added } = makeFakeCtx({ toolOutputCache });
    const h = new ChatCommandHandlers(ctx);
    await h.dispatch("cache", "status");

    expect(added[0]).toContain("Tool-Output Cache");
    expect(added[0]).toContain("Entries:** 4");
  });

  it("/cache clear posts removal count", async () => {
    const toolOutputCache = {
      clear: vi.fn(() => 3),
      stats: vi.fn(),
      lruStats: vi.fn(),
      prune: vi.fn(),
      reembedHeuristic: vi.fn(),
    };
    const { ctx, added } = makeFakeCtx({ toolOutputCache });
    const h = new ChatCommandHandlers(ctx);
    await h.dispatch("cache", "clear");

    expect(toolOutputCache.clear).toHaveBeenCalled();
    expect(added[0]).toContain("Cleared 3 entries");
  });

  it("/operation-log with no log reports unavailable", async () => {
    const { ctx, added } = makeFakeCtx({ operationLog: null });
    const h = new ChatCommandHandlers(ctx);
    await h.dispatch("operation-log", "");

    expect(added[0]).toContain("Operation log is unavailable");
  });

  it("/operation-log status renders state", async () => {
    const operationLog = {
      status: vi.fn(() => ({
        enabled: true,
        filePath: "/x/log",
        fileSizeBytes: 0,
        lastLines: [],
      })),
      clear: vi.fn(),
    };
    const { ctx, added } = makeFakeCtx({ operationLog });
    const h = new ChatCommandHandlers(ctx);
    await h.dispatch("operation-log", "status");

    expect(added[0]).toContain("Operation Log");
  });

  it("/operation-log status renders recent entries when present", async () => {
    const operationLog = {
      status: vi.fn(() => ({
        enabled: true,
        filePath: "/x/log",
        fileSizeBytes: 1024,
        lastLines: ["entry-a", "entry-b"],
      })),
      clear: vi.fn(),
    };
    const { ctx, added } = makeFakeCtx({ operationLog });
    const h = new ChatCommandHandlers(ctx);
    await h.dispatch("operation-log", "status");

    expect(added[0]).toContain("entry-a");
    expect(added[0]).toContain("entry-b");
  });

  it("/operation-log status hints at the enabled setting when disabled", async () => {
    const operationLog = {
      status: vi.fn(() => ({
        enabled: false,
        filePath: null,
        fileSizeBytes: 0,
        lastLines: [],
      })),
      clear: vi.fn(),
    };
    const { ctx, added } = makeFakeCtx({ operationLog });
    const h = new ChatCommandHandlers(ctx);
    await h.dispatch("operation-log", "status");

    expect(added[0]).toContain("operationLog.enabled");
  });

  it("/operation-log clear resets the log", async () => {
    const operationLog = {
      status: vi.fn(() => ({
        enabled: true,
        filePath: "/x/log",
        fileSizeBytes: 0,
        lastLines: [],
      })),
      clear: vi.fn(),
    };
    const { ctx, added } = makeFakeCtx({ operationLog });
    const h = new ChatCommandHandlers(ctx);
    await h.dispatch("operation-log", "clear");

    expect(operationLog.clear).toHaveBeenCalled();
    expect(added[0]).toContain("cleared");
  });

  it("/cache prune respects cache contents", async () => {
    const toolOutputCache = {
      stats: vi.fn(() => ({ entries: 0, topByHits: [] })),
      lruStats: vi.fn(() => ({ entries: 0, bytes: 0, hits: 0, misses: 0 })),
      clear: vi.fn(),
      prune: vi.fn(() => 5),
      reembedHeuristic: vi.fn(),
    };
    const { ctx, added } = makeFakeCtx({ toolOutputCache });
    const h = new ChatCommandHandlers(ctx);
    await h.dispatch("cache", "prune");

    expect(toolOutputCache.prune).toHaveBeenCalled();
    expect(added[0]).toContain("Pruned 5");
  });

  it("/cache reembed reports re-embedding totals", async () => {
    const toolOutputCache = {
      stats: vi.fn(),
      lruStats: vi.fn(),
      clear: vi.fn(),
      prune: vi.fn(),
      reembedHeuristic: vi.fn().mockResolvedValue({ scanned: 4, reembedded: 3 }),
    };
    const { ctx, added } = makeFakeCtx({ toolOutputCache });
    const h = new ChatCommandHandlers(ctx);
    await h.dispatch("cache", "reembed");

    expect(toolOutputCache.reembedHeuristic).toHaveBeenCalled();
    expect(added[0]).toContain("Re-embedded 3 of 4");
  });

  it("/mcp connect attaches a server and refreshes the tool list", async () => {
    const mcpManager = {
      connectServer: vi.fn().mockResolvedValue(undefined),
      disconnectServer: vi.fn(),
      getAllToolMetadata: vi.fn(() => [{ name: "newTool" }]),
      getServerStates: vi.fn(() => []),
    };
    const { ctx } = makeFakeCtx({
      mcpManager,
      mcpEnabled: true,
    });
    const h = new ChatCommandHandlers(ctx);
    await h.dispatch("mcp", "connect alpha");

    expect(mcpManager.connectServer).toHaveBeenCalledWith("alpha");
    expect(ctx.setMcpTools).toHaveBeenCalled();
  });

  it("/mcp disconnect detaches a server", async () => {
    const mcpManager = {
      connectServer: vi.fn(),
      disconnectServer: vi.fn().mockResolvedValue(undefined),
      getAllToolMetadata: vi.fn(() => []),
      getServerStates: vi.fn(() => []),
    };
    const { ctx } = makeFakeCtx({
      mcpManager,
      mcpEnabled: true,
    });
    const h = new ChatCommandHandlers(ctx);
    await h.dispatch("mcp", "disconnect alpha");

    expect(mcpManager.disconnectServer).toHaveBeenCalledWith("alpha");
  });

  it("/mcp with disabled setting prints disabled banner", async () => {
    const { ctx, added } = makeFakeCtx({ mcpManager: null, mcpEnabled: false });
    const h = new ChatCommandHandlers(ctx);
    await h.dispatch("mcp", "status");

    expect(added[0]).toContain("MCP support is disabled");
  });

  it("/mcp status renders connection summary", async () => {
    const mcpManager = {
      getServerStates: vi.fn(() => []),
      getAllToolMetadata: vi.fn(() => []),
    };
    const { ctx, added } = makeFakeCtx({
      mcpManager,
      mcpEnabled: true,
      mcpTools: [],
    });
    const h = new ChatCommandHandlers(ctx);
    await h.dispatch("mcp", "status");

    expect(added[0]).toContain("MCP Status");
  });

  it("/verify spawns a verification sub-agent", async () => {
    const { ctx, added } = makeFakeCtx();
    const h = new ChatCommandHandlers(ctx);
    await h.dispatch("verify", "");

    expect(ctx.subAgentManager.run).toHaveBeenCalled();
    expect(added[0]).toContain("Verification Report");
  });

  it("/research rejects an empty query", async () => {
    const { ctx, added } = makeFakeCtx();
    const h = new ChatCommandHandlers(ctx);
    await h.dispatch("research", "");

    expect(added[0]).toContain("Usage:");
    expect(ctx.subAgentManager.run).not.toHaveBeenCalled();
  });

  it("/research spawns a research sub-agent", async () => {
    const { ctx, added } = makeFakeCtx();
    const h = new ChatCommandHandlers(ctx);
    await h.dispatch("research", "what is the capital of France");

    expect(ctx.subAgentManager.run).toHaveBeenCalled();
    expect(added[0]).toContain("Research Results");
  });

  it("/model surfaces an error when Ollama is unreachable", async () => {
    const ctxBag = makeFakeCtx();
    (ctxBag.ctx.runtime.getOllamaClient as ReturnType<typeof vi.fn>).mockReturnValue({
      listModels: vi.fn().mockResolvedValue([]),
    });
    const h = new ChatCommandHandlers(ctxBag.ctx);
    await h.dispatch("model", "");

    const errorPost = ctxBag.posted.find((p) => p.msg.type === "error");
    expect(errorPost).toBeDefined();
  });

  it("/memory lint runs the lint helper", async () => {
    const memoryStore = {
      getStats: vi.fn(() => ({ totalEntries: 0, embeddingCount: 0, byType: {} })),
    };
    const { ctx, added } = makeFakeCtx({ memoryStore });
    const h = new ChatCommandHandlers(ctx);
    await h.dispatch("memory", "lint --dry-run");

    expect(added[0]).toContain("_lint ok_");
  });

  it("/memory init scaffolds the file architecture", async () => {
    const memoryFiles = {
      init: vi.fn(() => ({
        instructions: "created" as const,
        memory: "created" as const,
        context: "created" as const,
        instructionsPath: "/ws/Instructions.md",
        memoryPath: "/ws/Memory.md",
        contextPath: "/ws/Context.md",
      })),
      workspaceDir: "/home/u/.gemma-code/memory/ws",
    };
    const { ctx, added } = makeFakeCtx({ memoryFiles });
    const h = new ChatCommandHandlers(ctx);
    await h.dispatch("memory", "init");

    expect(memoryFiles.init).toHaveBeenCalledWith(false);
    expect(added[0]).toContain("Memory file initialisation");
    expect(added[0]).toContain("Instructions.md");
  });

  it("/memory init --force passes the overwrite flag", async () => {
    const memoryFiles = {
      init: vi.fn(() => ({
        instructions: "created" as const,
        memory: "created" as const,
        context: "created" as const,
        instructionsPath: "/ws/Instructions.md",
        memoryPath: "/ws/Memory.md",
        contextPath: "/ws/Context.md",
      })),
      workspaceDir: "/home/u/.gemma-code/memory/ws",
    };
    const { ctx } = makeFakeCtx({ memoryFiles });
    const h = new ChatCommandHandlers(ctx);
    await h.dispatch("memory", "init --force");

    expect(memoryFiles.init).toHaveBeenCalledWith(true);
  });

  it("/memory init without a workspace surfaces a hint", async () => {
    const { ctx, added } = makeFakeCtx({ memoryFiles: null });
    const h = new ChatCommandHandlers(ctx);
    await h.dispatch("memory", "init");
    expect(added[0]).toContain("requires an open workspace");
  });

  it("/memory archive snapshots the three files", async () => {
    const memoryFiles = {
      archive: vi.fn(() => ({
        archivedPath: "/home/u/.gemma-code/memory/ws/Archive/2026-05-05",
        archivedAt: new Date("2026-05-05T12:00:00Z"),
      })),
    };
    const { ctx, added } = makeFakeCtx({ memoryFiles });
    const h = new ChatCommandHandlers(ctx);
    await h.dispatch("memory", "archive");
    expect(memoryFiles.archive).toHaveBeenCalled();
    expect(added[0]).toContain("Memory archive");
    expect(added[0]).toContain("Archive/2026-05-05");
  });

  it("/memory edit defaults to Memory.md", async () => {
    const vscode = await import("vscode");
    const memoryFiles = {
      memoryPath: "/ws/Memory.md",
      instructionsPath: "/ws/Instructions.md",
      contextPath: "/ws/Context.md",
    };
    const { ctx } = makeFakeCtx({ memoryFiles });
    const h = new ChatCommandHandlers(ctx);
    await h.dispatch("memory", "edit");
    expect(vscode.workspace.openTextDocument).toHaveBeenCalledWith({ fsPath: "/ws/Memory.md" });
    expect(vscode.window.showTextDocument).toHaveBeenCalled();
  });

  it("/memory edit context opens Context.md", async () => {
    const vscode = await import("vscode");
    const memoryFiles = {
      memoryPath: "/ws/Memory.md",
      instructionsPath: "/ws/Instructions.md",
      contextPath: "/ws/Context.md",
    };
    const { ctx } = makeFakeCtx({ memoryFiles });
    const h = new ChatCommandHandlers(ctx);
    await h.dispatch("memory", "edit context");
    expect(vscode.workspace.openTextDocument).toHaveBeenCalledWith({ fsPath: "/ws/Context.md" });
  });

  it("/memory edit unknown surfaces usage help", async () => {
    const memoryFiles = {
      memoryPath: "/ws/Memory.md",
      instructionsPath: "/ws/Instructions.md",
      contextPath: "/ws/Context.md",
    };
    const { ctx, added } = makeFakeCtx({ memoryFiles });
    const h = new ChatCommandHandlers(ctx);
    await h.dispatch("memory", "edit bogus");
    expect(added[0]).toContain("Usage:");
  });

  // v0.7.0 Phase 5 -- /memory forget|export|import slash-command surface.
  it("/memory forget rejects an empty pattern with usage help", async () => {
    const memoryFiles = { memoryPath: "/ws/Memory.md", removeFromMemory: vi.fn() };
    const { ctx, added } = makeFakeCtx({ memoryFiles });
    const h = new ChatCommandHandlers(ctx);
    await h.dispatch("memory", "forget");
    expect(added[0]).toContain("Usage:");
    expect(memoryFiles.removeFromMemory).not.toHaveBeenCalled();
  });

  it("/memory forget removes matching lines from Memory.md", async () => {
    const memoryFiles = {
      memoryPath: "/ws/Memory.md",
      removeFromMemory: vi.fn(() => ({ removedLines: 3 })),
    };
    const { ctx, added } = makeFakeCtx({ memoryFiles });
    const h = new ChatCommandHandlers(ctx);
    await h.dispatch("memory", "forget ^- prefer:");
    expect(memoryFiles.removeFromMemory).toHaveBeenCalledWith("^- prefer:");
    expect(added[0]).toContain("Removed **3** lines");
  });

  it("/memory forget --include-sql also deletes matching SQL rows", async () => {
    const memoryFiles = {
      memoryPath: "/ws/Memory.md",
      removeFromMemory: vi.fn(() => ({ removedLines: 1 })),
    };
    const memoryStore = {
      listAll: vi.fn(() => [
        { id: "a", content: "prefer Conventional Commits", type: "fact" },
        { id: "b", content: "use ruff for python", type: "fact" },
      ]),
      deleteById: vi.fn(() => true),
    };
    const { ctx, added, postMemoryStatus } = makeFakeCtx({ memoryFiles, memoryStore });
    const h = new ChatCommandHandlers(ctx);
    await h.dispatch("memory", "forget Conventional --include-sql");
    expect(memoryStore.deleteById).toHaveBeenCalledWith("a");
    expect(memoryStore.deleteById).not.toHaveBeenCalledWith("b");
    expect(added[0]).toContain("Also removed 1 matching SQL-backed memory");
    expect(postMemoryStatus).toHaveBeenCalled();
  });

  it("/memory forget surfaces the catastrophic-pattern error verbatim", async () => {
    const memoryFiles = {
      memoryPath: "/ws/Memory.md",
      removeFromMemory: vi.fn(() => {
        throw new Error("Refused to remove: pattern \".*\" is too greedy.");
      }),
    };
    const { ctx, added } = makeFakeCtx({ memoryFiles });
    const h = new ChatCommandHandlers(ctx);
    await h.dispatch("memory", "forget .*");
    expect(added[0]).toContain("/memory forget failed");
    expect(added[0]).toContain("too greedy");
  });

  it("/memory forget without a workspace surfaces a hint", async () => {
    const { ctx, added } = makeFakeCtx({ memoryFiles: null });
    const h = new ChatCommandHandlers(ctx);
    await h.dispatch("memory", "forget anything");
    expect(added[0]).toContain("requires an open workspace");
  });

  it("/memory export writes the JSON dump and includes SQL rows when available", async () => {
    const memoryFiles = {
      memoryPath: "/ws/Memory.md",
      export: vi.fn(),
    };
    const memoryStore = {
      listAll: vi.fn(() => [
        { id: "x", content: "Always squash-merge", type: "fact" },
        { id: "y", content: "ruff for python", type: "preference" },
      ]),
    };
    const { ctx, added } = makeFakeCtx({ memoryFiles, memoryStore });
    const h = new ChatCommandHandlers(ctx);
    await h.dispatch("memory", "export /tmp/memory.json");
    expect(memoryFiles.export).toHaveBeenCalledWith("/tmp/memory.json", {
      sqlMemories: [
        { content: "Always squash-merge", type: "fact" },
        { content: "ruff for python", type: "preference" },
      ],
    });
    expect(added[0]).toContain("2 SQL-backed entries");
  });

  it("/memory export still works when the SQL store is disabled", async () => {
    const memoryFiles = { memoryPath: "/ws/Memory.md", export: vi.fn() };
    const { ctx, added } = makeFakeCtx({ memoryFiles, memoryStore: null });
    const h = new ChatCommandHandlers(ctx);
    await h.dispatch("memory", "export /tmp/memory.json");
    expect(memoryFiles.export).toHaveBeenCalledWith("/tmp/memory.json", { sqlMemories: [] });
    expect(added[0]).toContain("0 SQL-backed entries");
  });

  it("/memory export without a path emits usage help", async () => {
    const memoryFiles = { memoryPath: "/ws/Memory.md", export: vi.fn() };
    const { ctx, added } = makeFakeCtx({ memoryFiles });
    const h = new ChatCommandHandlers(ctx);
    await h.dispatch("memory", "export");
    expect(added[0]).toContain("Usage:");
    expect(memoryFiles.export).not.toHaveBeenCalled();
  });

  it("/memory export surfaces the secret-path error verbatim", async () => {
    const memoryFiles = {
      memoryPath: "/ws/Memory.md",
      export: vi.fn(() => {
        throw new Error("Refused to export to a secret path: /home/me/.aws/credentials");
      }),
    };
    const { ctx, added } = makeFakeCtx({ memoryFiles, memoryStore: null });
    const h = new ChatCommandHandlers(ctx);
    await h.dispatch("memory", "export /home/me/.aws/credentials");
    expect(added[0]).toContain("/memory export failed");
    expect(added[0]).toContain("secret path");
  });

  it("/memory import defaults to merge mode", async () => {
    const memoryFiles = { memoryPath: "/ws/Memory.md", import: vi.fn() };
    const { ctx, added } = makeFakeCtx({ memoryFiles });
    const h = new ChatCommandHandlers(ctx);
    await h.dispatch("memory", "import /tmp/memory.json");
    expect(memoryFiles.import).toHaveBeenCalledWith("/tmp/memory.json", "merge");
    expect(added[0]).toContain("mode: **merge**");
  });

  it("/memory import --mode=replace overwrites the on-disk files", async () => {
    const memoryFiles = { memoryPath: "/ws/Memory.md", import: vi.fn() };
    const { ctx, added } = makeFakeCtx({ memoryFiles });
    const h = new ChatCommandHandlers(ctx);
    await h.dispatch("memory", "import /tmp/memory.json --mode=replace");
    expect(memoryFiles.import).toHaveBeenCalledWith("/tmp/memory.json", "replace");
    expect(added[0]).toContain("mode: **replace**");
  });

  it("/memory import without a path surfaces usage help", async () => {
    const memoryFiles = { memoryPath: "/ws/Memory.md", import: vi.fn() };
    const { ctx, added } = makeFakeCtx({ memoryFiles });
    const h = new ChatCommandHandlers(ctx);
    await h.dispatch("memory", "import");
    expect(added[0]).toContain("Usage:");
    expect(memoryFiles.import).not.toHaveBeenCalled();
  });

  it("/memory import surfaces underlying parse errors", async () => {
    const memoryFiles = {
      memoryPath: "/ws/Memory.md",
      import: vi.fn(() => {
        throw new Error("Invalid memory export at /tmp/memory.json: Unexpected token");
      }),
    };
    const { ctx, added } = makeFakeCtx({ memoryFiles });
    const h = new ChatCommandHandlers(ctx);
    await h.dispatch("memory", "import /tmp/memory.json");
    expect(added[0]).toContain("/memory import failed");
    expect(added[0]).toContain("Invalid memory export");
  });
});

describe("Phase 5 memory-command parsers", () => {
  it("parseForgetArgs splits the pattern from the --include-sql flag", () => {
    expect(parseForgetArgs("^- prefer: --include-sql")).toEqual({
      pattern: "^- prefer:",
      includeSql: true,
    });
    expect(parseForgetArgs("--include-sql ^- prefer:")).toEqual({
      pattern: "^- prefer:",
      includeSql: true,
    });
    expect(parseForgetArgs("foo bar")).toEqual({ pattern: "foo bar", includeSql: false });
    expect(parseForgetArgs("")).toEqual({ pattern: "", includeSql: false });
  });

  it("parseImportArgs honours --mode= and --replace shorthand", () => {
    expect(parseImportArgs("/tmp/x.json")).toEqual({ path: "/tmp/x.json", mode: "merge" });
    expect(parseImportArgs("/tmp/x.json --mode=replace")).toEqual({
      path: "/tmp/x.json",
      mode: "replace",
    });
    expect(parseImportArgs("--replace /tmp/x.json")).toEqual({
      path: "/tmp/x.json",
      mode: "replace",
    });
    expect(parseImportArgs("/tmp/x.json --mode=merge")).toEqual({
      path: "/tmp/x.json",
      mode: "merge",
    });
  });

  it("forgetMatchingSqlRows deletes only matching rows", () => {
    const rows = [
      { id: "a", content: "prefer Conventional Commits" },
      { id: "b", content: "use ruff" },
      { id: "c", content: "Conventional release tagging" },
    ];
    const deleted: string[] = [];
    const removed = forgetMatchingSqlRows(
      {
        listAll: () => rows,
        deleteById: (id: string) => {
          deleted.push(id);
          return true;
        },
      },
      "Conventional",
    );
    expect(removed).toBe(2);
    expect(deleted.sort()).toEqual(["a", "c"]);
  });

  it("forgetMatchingSqlRows returns 0 when the pattern is invalid", () => {
    const removed = forgetMatchingSqlRows(
      {
        listAll: () => [{ id: "a", content: "anything" }],
        deleteById: () => true,
      },
      "(",
    );
    expect(removed).toBe(0);
  });
});
