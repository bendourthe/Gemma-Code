import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockOf } from "../../helpers/factories.js";
import type { ChatControllerContext } from "../../../src/panels/ChatController.js";
import { ChatController } from "../../../src/panels/ChatController.js";
import type { ExtensionToWebviewMessage } from "../../../src/panels/messages.js";

vi.mock("vscode", () => ({
  workspace: {
    workspaceFolders: [{ uri: { fsPath: "/ws" } }],
    getConfiguration: vi.fn(() => ({ update: vi.fn() })),
  },
  window: { showQuickPick: vi.fn() },
  ConfigurationTarget: { Global: 1 },
}));

vi.mock("../../../modules/coding/utils/MarkdownRenderer.js", () => ({
  renderMarkdown: (s: string) => `<r>${s}</r>`,
}));

vi.mock("../../../modules/coding/chat/PlanMode.js", async () => {
  return {
    detectPlan: vi.fn((text: string) =>
      text.includes("step1\nstep2") ? ["step1", "step2"] : null,
    ),
    PlanMode: class {},
  };
});

vi.mock("../../../modules/coding/config/PromptBudget.js", () => ({
  calculateBudget: vi.fn(() => ({ memoryBudget: 1024 })),
}));

interface PostedMessage {
  msg: ExtensionToWebviewMessage;
}

interface CtxOptions {
  planActive?: boolean;
  shouldOrchestrate?: boolean;
  routeResult?: ReturnType<NonNullable<ChatControllerContext["commandRouter"]["route"]>>;
  memoryStore?: unknown;
  retriever?: { retrieveForPrompt: ReturnType<typeof vi.fn> } | null;
  skill?: { name: string; prompt: string } | null;
}

function makeCtx(opts: CtxOptions = {}): {
  ctx: ChatControllerContext;
  posted: PostedMessage[];
  pipelineSend: ReturnType<typeof vi.fn>;
  postHistory: ReturnType<typeof vi.fn>;
  postTokenCount: ReturnType<typeof vi.fn>;
  orchestratorExecute: ReturnType<typeof vi.fn>;
} {
  const posted: PostedMessage[] = [];
  let assistantId = 0;

  const manager = mockOf<ChatControllerContext["manager"]>({
    addAssistantMessage: vi.fn((content: string) => ({
      id: `m${++assistantId}`,
      role: "assistant",
      content,
      timestamp: Date.now(),
    })),
    rebuildSystemPrompt: vi.fn(),
    clearHistory: vi.fn(),
    getHistory: vi.fn(() => [
      {
        id: "a1",
        role: "assistant",
        content: "Plan:\nstep1\nstep2",
        timestamp: 0,
      },
    ]),
  });

  const planMode = mockOf<ChatControllerContext["planMode"]>({
    active: opts.planActive ?? false,
    state: { currentPlan: [{ description: "do thing" }] },
    setPlan: vi.fn(),
    approveStep: vi.fn(),
    markStepDone: vi.fn(),
    resetPlan: vi.fn(),
    toggle: vi.fn(),
  });

  const promptBuilder = mockOf<ChatControllerContext["promptBuilder"]>({
    build: vi.fn(() => "system prompt"),
  });

  const compactor = mockOf<ChatControllerContext["compactor"]>({});

  const commandRouter = mockOf<ChatControllerContext["commandRouter"]>({
    route: vi.fn(() => opts.routeResult ?? null),
    getAllDescriptors: vi.fn(() => []),
  });

  const runtime = mockOf<ChatControllerContext["runtime"]>({
    getOllamaClient: vi.fn(),
  });

  const subAgentManager = mockOf<ChatControllerContext["subAgentManager"]>({
    run: vi.fn(),
  });

  const agentLoop = mockOf<ChatControllerContext["agentLoop"]>({
    cancel: vi.fn(),
    getModifiedFiles: vi.fn(() => []),
    getRecentToolResults: vi.fn(() => []),
    setCurrentSkill: vi.fn(),
  });

  const pipelineSend = vi.fn().mockResolvedValue(undefined);
  const pipeline = mockOf<ChatControllerContext["pipeline"]>({
    send: pipelineSend,
    cancel: vi.fn(),
  });

  const orchestratorExecute = vi.fn().mockResolvedValue({ summary: "done" });
  const orchestrator = mockOf<ChatControllerContext["orchestrator"]>({
    shouldUseOrchestrator: vi.fn(() => opts.shouldOrchestrate ?? false),
    execute: orchestratorExecute,
  });

  const skillLoader = mockOf<ChatControllerContext["skillLoader"]>({
    getSkill: vi.fn(() => opts.skill ?? null),
  });

  const postHistory = vi.fn();
  const postTokenCount = vi.fn();

  const ctx: ChatControllerContext = {
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
    getStore: () => null,
    getMemoryStore: () => (opts.memoryStore as never) ?? null,
    getToolOutputCache: () => null,
    getOperationLog: () => null,
    getMcpManager: () => null,
    getMcpTools: () => [],
    setMcpTools: vi.fn(),
    getUnifiedRetriever: () => (opts.retriever as never) ?? null,
    getSettings: () => ({ maxTokens: 8000 }) as never,
    buildPromptContext: vi.fn(() => ({}) as never),
    postMessage: (m: ExtensionToWebviewMessage) => posted.push({ msg: m }),
    postHistory,
    postTokenCount,
    postMemoryStatus: vi.fn(),
    postMcpStatus: vi.fn(),
  };

  return { ctx, posted, pipelineSend, postHistory, postTokenCount, orchestratorExecute };
}

describe("ChatController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("submitUserMessage with plain text streams via the pipeline", async () => {
    const { ctx, pipelineSend } = makeCtx();
    const c = new ChatController(ctx);
    await c.submitUserMessage("hello");

    expect(pipelineSend).toHaveBeenCalledWith("hello", expect.any(Function));
  });

  it("dispatches a builtin slash command without calling the pipeline", async () => {
    const { ctx, pipelineSend } = makeCtx({
      routeResult: { type: "builtin", name: "clear", args: "" },
    });
    const c = new ChatController(ctx);
    await c.submitUserMessage("/clear");

    expect(pipelineSend).not.toHaveBeenCalled();
  });

  it("expands a known skill command and forwards to the pipeline", async () => {
    const { ctx, pipelineSend } = makeCtx({
      routeResult: { type: "skill", name: "review", args: "the diff" },
      skill: { name: "review", prompt: "Review $ARGUMENTS." },
    });
    const c = new ChatController(ctx);
    await c.submitUserMessage("/review the diff");

    expect(pipelineSend).toHaveBeenCalled();
    const sent = pipelineSend.mock.calls[0]?.[0];
    expect(sent).toContain("Review the diff.");
  });

  it("posts an error when the skill is unknown", async () => {
    const { ctx, posted, pipelineSend } = makeCtx({
      routeResult: { type: "skill", name: "missing", args: "" },
      skill: null,
    });
    const c = new ChatController(ctx);
    await c.submitUserMessage("/missing");

    expect(pipelineSend).not.toHaveBeenCalled();
    expect(posted.find((p) => p.msg.type === "error")).toBeDefined();
  });

  it("routes to the orchestrator when plan mode is active and the request is complex", async () => {
    const { ctx, orchestratorExecute, pipelineSend } = makeCtx({
      planActive: true,
      shouldOrchestrate: true,
    });
    const c = new ChatController(ctx);
    await c.submitUserMessage("complex thing");

    expect(orchestratorExecute).toHaveBeenCalled();
    expect(pipelineSend).not.toHaveBeenCalled();
  });

  it("orchestrator failures emit an error message", async () => {
    const { ctx, posted, orchestratorExecute } = makeCtx({
      planActive: true,
      shouldOrchestrate: true,
    });
    orchestratorExecute.mockRejectedValueOnce(new Error("boom"));
    const c = new ChatController(ctx);
    await c.submitUserMessage("complex thing");

    expect(posted.find((p) => p.msg.type === "error")).toBeDefined();
  });

  it("cancelInFlight cancels both the pipeline and the agent loop", () => {
    const { ctx } = makeCtx();
    const c = new ChatController(ctx);
    c.cancelInFlight();

    expect(ctx.pipeline.cancel).toHaveBeenCalled();
    expect(ctx.agentLoop.cancel).toHaveBeenCalled();
  });

  it("approveStep advances plan-mode and streams the follow-up", async () => {
    const { ctx, pipelineSend } = makeCtx({ planActive: true });
    const c = new ChatController(ctx);
    await c.approveStep(0);

    expect(ctx.planMode.approveStep).toHaveBeenCalledWith(0);
    expect(pipelineSend).toHaveBeenCalled();
    expect(ctx.planMode.markStepDone).toHaveBeenCalledWith(0);
  });

  it("approveStep is a no-op for an out-of-range index", async () => {
    const { ctx, pipelineSend } = makeCtx({ planActive: true });
    const c = new ChatController(ctx);
    await c.approveStep(99);

    expect(ctx.planMode.approveStep).not.toHaveBeenCalled();
    expect(pipelineSend).not.toHaveBeenCalled();
  });

  it("injects memory context via the unified retriever when present", async () => {
    const retrieve = vi.fn().mockResolvedValue("recent context");
    const { ctx } = makeCtx({
      retriever: { retrieveForPrompt: retrieve },
    });
    const c = new ChatController(ctx);
    await c.submitUserMessage("hi");

    expect(retrieve).toHaveBeenCalled();
    expect(ctx.manager.rebuildSystemPrompt).toHaveBeenCalled();
  });

  it("falls back to MemoryStore.retrieve when no retriever is wired", async () => {
    const memoryStore = { retrieve: vi.fn().mockResolvedValue("ctx") };
    const { ctx } = makeCtx({ memoryStore });
    const c = new ChatController(ctx);
    await c.submitUserMessage("hi");

    expect(memoryStore.retrieve).toHaveBeenCalled();
  });

  it("memory failures are silently ignored", async () => {
    const memoryStore = {
      retrieve: vi.fn().mockRejectedValue(new Error("oops")),
    };
    const { ctx, pipelineSend } = makeCtx({ memoryStore });
    const c = new ChatController(ctx);
    await c.submitUserMessage("hi");

    expect(pipelineSend).toHaveBeenCalled();
    expect(ctx.manager.rebuildSystemPrompt).not.toHaveBeenCalled();
  });
});
