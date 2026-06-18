import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockOf } from "../../helpers/factories.js";
import type { ChatControllerContext } from "../../../src/panels/ChatController.js";
import { ChatController } from "../../../src/panels/ChatController.js";
import type { ExtensionToWebviewMessage } from "../../../src/panels/messages.js";
import type { PanelRouter } from "../../../modules/coding/llm/PanelRouter.js";
import type { PanelRouteResult } from "../../../modules/coding/llm/PanelRouter.js";
import type { PanelRunResult } from "../../../modules/coding/orchestration/PanelExecutor.js";

// v1.6.0 adoption-openrouter-fusion Phase 5 (OF011): the live panel-routing
// consult in `submitUserMessage`. These tests prove the OPT-IN / DEFAULT-OFF
// contract: a non-null router that escalates to a fused panel run renders the
// fused answer and skips the streaming pipeline; a null router (the default)
// leaves the single-model pipeline path unchanged.

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
    detectPlan: vi.fn(() => null),
    PlanMode: class {},
  };
});

vi.mock("../../../modules/coding/config/PromptBudget.js", () => ({
  calculateBudget: vi.fn(() => ({ memoryBudget: 1024 })),
}));

interface PostedMessage {
  msg: ExtensionToWebviewMessage;
}

interface PanelCtxOptions {
  /** When provided, a non-null PanelRouter whose `route` resolves to this. */
  routeResult?: PanelRouteResult;
  /** When the router should reject, the consult must fall through to the pipeline. */
  routeRejects?: boolean;
  /** Distinct installed-model panel spec the provider returns. */
  panelSpec?: readonly string[];
}

/** Build a fused (panel) route result with the given fused output. */
function fusedRouteResult(fusedOutput: string): PanelRouteResult {
  const run = {
    candidates: [],
    fusion: {
      fusedOutput,
      schemaValid: true,
      judgeModel: "judge",
      fusedCandidateCount: 2,
    },
    dispatched: ["m-a", "m-b"],
    skipped: [],
    succeeded: 2,
    failed: 0,
  } satisfies PanelRunResult;
  return {
    decision: { kind: "panel", panel: ["m-a", "m-b"], reason: "escalated" },
    run,
  };
}

/** A `single` route result -- the router declined to escalate. */
function singleRouteResult(): PanelRouteResult {
  return {
    decision: { kind: "single", model: "gemma4:e4b", reason: "not escalated" },
    run: null,
  };
}

function makeCtx(opts: PanelCtxOptions = {}): {
  ctx: ChatControllerContext;
  posted: PostedMessage[];
  pipelineSend: ReturnType<typeof vi.fn>;
  addUserMessage: ReturnType<typeof vi.fn>;
  addAssistantMessage: ReturnType<typeof vi.fn>;
  routeFn: ReturnType<typeof vi.fn> | null;
  panelSpecProvider: ReturnType<typeof vi.fn> | undefined;
} {
  const posted: PostedMessage[] = [];
  let assistantId = 0;

  const addAssistantMessage = vi.fn((content: string) => ({
    id: `m${++assistantId}`,
    role: "assistant",
    content,
    timestamp: Date.now(),
  }));
  const addUserMessage = vi.fn((content: string) => ({
    id: `u${++assistantId}`,
    role: "user",
    content,
    timestamp: Date.now(),
  }));

  const manager = mockOf<ChatControllerContext["manager"]>({
    addAssistantMessage,
    addUserMessage,
    rebuildSystemPrompt: vi.fn(),
    getHistory: vi.fn(() => [
      {
        id: "m1",
        role: "assistant",
        content: "fused reply",
        timestamp: 0,
      },
    ]),
  });

  const planMode = mockOf<ChatControllerContext["planMode"]>({
    active: false,
    state: { currentPlan: [] },
    setPlan: vi.fn(),
  });

  const promptBuilder = mockOf<ChatControllerContext["promptBuilder"]>({
    build: vi.fn(() => "system prompt"),
  });

  const commandRouter = mockOf<ChatControllerContext["commandRouter"]>({
    route: vi.fn(() => null),
  });

  const runtime = mockOf<ChatControllerContext["runtime"]>({
    getOllamaClient: vi.fn(),
  });

  const agentLoop = mockOf<ChatControllerContext["agentLoop"]>({
    cancel: vi.fn(),
    setCurrentSkill: vi.fn(),
  });

  const pipelineSend = vi.fn().mockResolvedValue(undefined);
  const pipeline = mockOf<ChatControllerContext["pipeline"]>({
    send: pipelineSend,
    cancel: vi.fn(),
  });

  const orchestrator = mockOf<ChatControllerContext["orchestrator"]>({
    shouldUseOrchestrator: vi.fn(() => false),
  });

  const skillLoader = mockOf<ChatControllerContext["skillLoader"]>({
    getSkill: vi.fn(() => null),
  });

  // Build the optional panel-routing deps. A null router (no `routeResult` and
  // not `routeRejects`) reproduces the default OFF posture.
  let panelRouter: PanelRouter | null = null;
  let routeFn: ReturnType<typeof vi.fn> | null = null;
  let panelSpecProvider: ReturnType<typeof vi.fn> | undefined;
  if (opts.routeResult || opts.routeRejects) {
    routeFn = opts.routeRejects
      ? vi.fn().mockRejectedValue(new Error("panel boom"))
      : vi.fn().mockResolvedValue(opts.routeResult);
    panelRouter = mockOf<PanelRouter>({ route: routeFn as never });
    panelSpecProvider = vi
      .fn()
      .mockResolvedValue(opts.panelSpec ?? ["m-a", "m-b"]);
  }

  const ctx: ChatControllerContext = {
    manager,
    planMode,
    promptBuilder,
    compactor: mockOf<ChatControllerContext["compactor"]>({}),
    commandRouter,
    runtime,
    subAgentManager: mockOf<ChatControllerContext["subAgentManager"]>({}),
    agentLoop,
    pipeline,
    orchestrator,
    skillLoader,
    panelRouter,
    ...(panelSpecProvider ? { panelSpecProvider } : {}),
    getStore: () => null,
    getMemoryStore: () => null,
    getToolOutputCache: () => null,
    getOperationLog: () => null,
    getMcpManager: () => null,
    getMcpTools: () => [],
    setMcpTools: vi.fn(),
    getUnifiedRetriever: () => null,
    getSettings: () => ({ maxTokens: 8000, modelName: "gemma4:e4b" }) as never,
    buildPromptContext: vi.fn(() => ({}) as never),
    postMessage: (m: ExtensionToWebviewMessage) => posted.push({ msg: m }),
    postHistory: vi.fn(),
    postTokenCount: vi.fn(),
    postMemoryStatus: vi.fn(),
    postMcpStatus: vi.fn(),
  };

  return {
    ctx,
    posted,
    pipelineSend,
    addUserMessage,
    addAssistantMessage,
    routeFn,
    panelSpecProvider,
  };
}

describe("ChatController panel routing (OF011)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the fused answer and skips the pipeline when the router escalates to a panel", async () => {
    const {
      ctx,
      posted,
      pipelineSend,
      addUserMessage,
      addAssistantMessage,
      routeFn,
      panelSpecProvider,
    } = makeCtx({ routeResult: fusedRouteResult("FUSED ANSWER") });

    const c = new ChatController(ctx);
    await c.submitUserMessage("a reliability-sensitive task");

    // The router was consulted with the live single-model name + panel spec.
    expect(panelSpecProvider).toHaveBeenCalledTimes(1);
    expect(routeFn).toHaveBeenCalledWith(
      expect.objectContaining({
        task: "a reliability-sensitive task",
        highReliability: true,
        singleModel: "gemma4:e4b",
        panelSpec: ["m-a", "m-b"],
      }),
    );

    // The user turn and the fused assistant message were recorded (history +
    // store parity with the single-model path).
    expect(addUserMessage).toHaveBeenCalledWith("a reliability-sensitive task");
    expect(addAssistantMessage).toHaveBeenCalledWith("FUSED ANSWER");

    // A messageComplete was posted (rendered from history by id).
    const complete = posted.find((p) => p.msg.type === "messageComplete");
    expect(complete).toBeDefined();

    // The single-model streaming pipeline was NOT used.
    expect(pipelineSend).not.toHaveBeenCalled();
  });

  it("falls through to the single-model pipeline when the router declines (single decision)", async () => {
    const { ctx, pipelineSend, addAssistantMessage, routeFn } = makeCtx({
      routeResult: singleRouteResult(),
    });

    const c = new ChatController(ctx);
    await c.submitUserMessage("ordinary task");

    expect(routeFn).toHaveBeenCalledTimes(1);
    // No fused assistant message rendered.
    expect(addAssistantMessage).not.toHaveBeenCalled();
    // The normal single-model path ran.
    expect(pipelineSend).toHaveBeenCalledWith("ordinary task", expect.any(Function));
  });

  it("goes through the normal pipeline path unchanged when panelRouter is null (default)", async () => {
    const { ctx, pipelineSend, addUserMessage, addAssistantMessage } = makeCtx();

    // Sanity: the default ctx has no router wired.
    expect(ctx.panelRouter ?? null).toBeNull();

    const c = new ChatController(ctx);
    await c.submitUserMessage("hello");

    // The pipeline handled the turn; the controller did not touch the manager
    // directly (the pipeline owns add-user / add-assistant on the single path).
    expect(pipelineSend).toHaveBeenCalledWith("hello", expect.any(Function));
    expect(addUserMessage).not.toHaveBeenCalled();
    expect(addAssistantMessage).not.toHaveBeenCalled();
  });

  it("falls through to the pipeline (turn not lost) when the router throws", async () => {
    const { ctx, pipelineSend, addAssistantMessage } = makeCtx({
      routeRejects: true,
    });

    const c = new ChatController(ctx);
    await c.submitUserMessage("task that breaks routing");

    // No fused message; the user's turn went through the single-model path.
    expect(addAssistantMessage).not.toHaveBeenCalled();
    expect(pipelineSend).toHaveBeenCalledWith(
      "task that breaks routing",
      expect.any(Function),
    );
  });
});
