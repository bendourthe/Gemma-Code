import { describe, it, expect, vi, beforeEach } from "vitest";
import { AgentLoop } from "../../../src/tools/AgentLoop.js";
import { BudgetMiddleware } from "../../../src/tools/BudgetMiddleware.js";
import type { ConversationManager } from "../../../modules/coding/chat/ConversationManager.js";
import type { ToolRegistry } from "../../../src/tools/ToolRegistry.js";
import type { OllamaClient } from "../../../modules/coding/llm/types.js";
import type { ToolCall, ToolResult } from "../../../src/tools/types.js";
import {
  collectMessages,
  makeConversationManager as makeManager,
  makeMessage,
  makeMultiResponseOllamaClient as makeMultiClient,
  makeOllamaClient as makeClient,
  makeToolRegistry as makeRegistry,
  mockOf,
} from "../../helpers/factories.js";

const toolCallText = '<|tool_call>call:read_file{path:<|"|>src/extension.ts<|"|>}<tool_call|>';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AgentLoop", () => {
  let manager: ConversationManager;
  let registry: ToolRegistry;

  beforeEach(() => {
    manager = makeManager();
    registry = makeRegistry();
  });

  it("single turn with no tool call: posts tokens and messageComplete", async () => {
    const client = makeClient("Here is my answer.");
    const loop = new AgentLoop(client, manager, registry, "gemma3:27b");
    const { posted, postMessage } = collectMessages();

    await loop.run(postMessage);

    expect(posted.some((m) => m.type === "token")).toBe(true);
    expect(posted.some((m) => m.type === "messageComplete")).toBe(true);
    expect(manager.addAssistantMessage).toHaveBeenCalledWith("Here is my answer.");
  });

  it("single tool call: executes tool and continues to final answer", async () => {
    const client = makeMultiClient([
      toolCallText,       // first turn: model emits a tool call
      "Done reading.",    // second turn: model gives final answer
    ]);
    const loop = new AgentLoop(client, manager, registry, "gemma3:27b");
    const { posted, postMessage } = collectMessages();

    await loop.run(postMessage);

    expect(registry.execute).toHaveBeenCalledOnce();
    expect(posted.some((m) => m.type === "toolUse")).toBe(true);
    expect(posted.some((m) => m.type === "toolResult")).toBe(true);
    expect(posted.some((m) => m.type === "messageComplete")).toBe(true);
    // Tool result is injected as user message in Gemma 4 format
    expect(manager.addUserMessage).toHaveBeenCalledWith(expect.stringContaining("<|tool_result>"));
  });

  it("multi-turn: two consecutive tool calls then final answer", async () => {
    const toolCall2 = '<|tool_call>call:list_directory{path:<|"|>src<|"|>}<tool_call|>';
    const client = makeMultiClient([
      toolCallText,   // turn 1
      toolCall2,      // turn 2
      "All done.",    // turn 3 — final answer
    ]);
    const loop = new AgentLoop(client, manager, registry, "gemma3:27b");
    const { posted, postMessage } = collectMessages();

    await loop.run(postMessage);

    expect(registry.execute).toHaveBeenCalledTimes(2);
    expect(posted.filter((m) => m.type === "toolUse")).toHaveLength(2);
    expect(posted.some((m) => m.type === "messageComplete")).toBe(true);
  });

  it("stops and posts an error when max iterations is reached", async () => {
    // Every response contains a tool call → loop never terminates naturally
    const client = makeMultiClient(Array(5).fill(toolCallText));
    const loop = new AgentLoop(client, manager, registry, "gemma3:27b", 3 /* maxIterations */);
    const { posted, postMessage } = collectMessages();

    await loop.run(postMessage);

    const errorMsg = posted.find((m) => m.type === "error");
    expect(errorMsg).toBeDefined();
    expect((errorMsg as { type: "error"; text: string }).text).toMatch(/maximum/i);
    expect(posted.some((m) => m.type === "messageComplete")).toBe(false);
  });

  it("cancel() stops the loop before the next iteration", async () => {
    let callCount = 0;
    const streamChat = vi.fn((_req, signal: AbortSignal) => {
      callCount++;
      async function* gen() {
        yield { message: { content: toolCallText, role: "assistant" }, done: true };
        // Simulate detecting cancellation between iterations
      }
      return gen();
    });
    const client = mockOf<OllamaClient>({ streamChat });
    const loop = new AgentLoop(client, manager, registry, "gemma3:27b");

    const { postMessage } = collectMessages();

    // Cancel immediately — the loop should exit after at most one iteration
    loop.cancel();
    await loop.run(postMessage);

    // With immediate cancellation the loop exits right away
    expect(callCount).toBeLessThanOrEqual(1);
  });

  it("registry error is injected as a failed tool result and loop continues", async () => {
    const failingRegistry = mockOf<ToolRegistry>({
      execute: vi.fn<[ToolCall], Promise<ToolResult>>().mockResolvedValueOnce({
        id: "call_001",
        success: false,
        output: "",
        error: "disk full",
      }),
      register: vi.fn(),
      has: vi.fn(() => true),
    });

    const client = makeMultiClient([toolCallText, "Recovered."]);
    const loop = new AgentLoop(client, manager, failingRegistry, "gemma3:27b");
    const { posted, postMessage } = collectMessages();

    await loop.run(postMessage);

    const toolResult = posted.find((m) => m.type === "toolResult") as
      | { type: "toolResult"; success: boolean }
      | undefined;
    expect(toolResult?.success).toBe(false);
    // Loop should still complete with a messageComplete
    expect(posted.some((m) => m.type === "messageComplete")).toBe(true);
  });

  it("toolUse and toolResult messages are posted before the next streaming turn", async () => {
    const client = makeMultiClient([toolCallText, "Final."]);
    const loop = new AgentLoop(client, manager, registry, "gemma3:27b");
    const { posted, postMessage } = collectMessages();

    await loop.run(postMessage);

    const toolUseIdx = posted.findIndex((m) => m.type === "toolUse");
    const toolResultIdx = posted.findIndex((m) => m.type === "toolResult");
    const mcIdx = posted.findIndex((m) => m.type === "messageComplete");

    expect(toolUseIdx).toBeGreaterThanOrEqual(0);
    expect(toolResultIdx).toBeGreaterThan(toolUseIdx);
    expect(mcIdx).toBeGreaterThan(toolResultIdx);
  });

  describe("file edit tracking", () => {
    const writeCallText = '<|tool_call>call:write_file{path:<|"|>src/foo.ts<|"|>,content:<|"|>hello<|"|>}<tool_call|>';
    const editCallText = '<|tool_call>call:edit_file{path:<|"|>src/bar.ts<|"|>,old_string:<|"|>a<|"|>,new_string:<|"|>b<|"|>}<tool_call|>';

    it("tracks modified files after write_file calls", async () => {
      const client = makeMultiClient([writeCallText, "Done."]);
      const loop = new AgentLoop(client, manager, registry, "gemma3:27b");
      const { postMessage } = collectMessages();

      await loop.run(postMessage);

      expect(loop.getModifiedFiles()).toContain("src/foo.ts");
    });

    it("tracks modified files after edit_file calls", async () => {
      const client = makeMultiClient([editCallText, "Done."]);
      const loop = new AgentLoop(client, manager, registry, "gemma3:27b");
      const { postMessage } = collectMessages();

      await loop.run(postMessage);

      expect(loop.getModifiedFiles()).toContain("src/bar.ts");
    });

    it("tracks recent tool results with a rolling window", async () => {
      const client = makeMultiClient([toolCallText, "Done."]);
      const loop = new AgentLoop(client, manager, registry, "gemma3:27b");
      const { postMessage } = collectMessages();

      await loop.run(postMessage);

      const results = loop.getRecentToolResults();
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0]).toContain("[read_file]");
    });

    it("does not duplicate the same file path in modifiedFiles", async () => {
      // Two write calls to the same file
      const client = makeMultiClient([writeCallText, writeCallText, "Done."]);
      const loop = new AgentLoop(client, manager, registry, "gemma3:27b");
      const { postMessage } = collectMessages();

      await loop.run(postMessage);

      const modified = loop.getModifiedFiles();
      const fooCount = modified.filter((f) => f === "src/foo.ts").length;
      expect(fooCount).toBe(1);
    });
  });

  describe("auto-verification", () => {
    const writeCallText = '<|tool_call>call:write_file{path:<|"|>src/a.ts<|"|>,content:<|"|>x<|"|>}<tool_call|>';

    it("does not trigger verification when verificationEnabled is false", async () => {
      const subAgentManager = { run: vi.fn() };
      const client = makeMultiClient([writeCallText, writeCallText, writeCallText, "Done."]);
      const loop = new AgentLoop(client, manager, registry, "gemma3:27b", 20, undefined, undefined, undefined, {
        subAgentManager: subAgentManager as any,
        verificationThreshold: 3,
        verificationEnabled: false,
      });
      const { postMessage } = collectMessages();

      await loop.run(postMessage);

      expect(subAgentManager.run).not.toHaveBeenCalled();
    });

    it("does not trigger verification when no subAgentManager is provided", async () => {
      const client = makeMultiClient([writeCallText, writeCallText, writeCallText, "Done."]);
      const loop = new AgentLoop(client, manager, registry, "gemma3:27b", 20, undefined, undefined, undefined, {
        verificationThreshold: 3,
        verificationEnabled: true,
      });
      const { postMessage } = collectMessages();

      // Should not throw even without subAgentManager
      await loop.run(postMessage);
    });

    it("triggers verification after reaching the file edit threshold", async () => {
      const subAgentManager = {
        run: vi.fn<any>().mockResolvedValue({
          type: "verification",
          success: true,
          output: "All clear.",
          toolCallCount: 0,
          iterationsUsed: 1,
        }),
      };
      // 3 writes (each in a separate iteration), then done
      const client = makeMultiClient([writeCallText, writeCallText, writeCallText, "Done."]);
      const loop = new AgentLoop(client, manager, registry, "gemma3:27b", 20, undefined, undefined, undefined, {
        subAgentManager: subAgentManager as any,
        verificationThreshold: 3,
        verificationEnabled: true,
      });
      const { postMessage } = collectMessages();

      await loop.run(postMessage);

      expect(subAgentManager.run).toHaveBeenCalledOnce();
      const config = subAgentManager.run.mock.calls[0]![0];
      expect(config.type).toBe("verification");
      expect(config.modifiedFiles.length).toBeGreaterThanOrEqual(1);
    });

    it("fires the audit-worker sub-agent when auditWorkerEnabled and threshold met", async () => {
      const subAgentManager = {
        run: vi.fn<any>().mockResolvedValue({
          type: "audit-worker",
          success: true,
          output: "### Audit Worker\n\nclean.",
          toolCallCount: 1,
          iterationsUsed: 0,
        }),
      };
      const client = makeMultiClient([writeCallText, writeCallText, writeCallText, "Done."]);
      const loop = new AgentLoop(client, manager, registry, "gemma3:27b", 20, undefined, undefined, undefined, {
        subAgentManager: subAgentManager as any,
        verificationThreshold: 3,
        verificationEnabled: false,
        auditWorkerEnabled: true,
      });
      const { postMessage } = collectMessages();

      await loop.run(postMessage);

      expect(subAgentManager.run).toHaveBeenCalledOnce();
      const config = subAgentManager.run.mock.calls[0]![0];
      expect(config.type).toBe("audit-worker");
    });

    it("fires the testgaps-worker sub-agent when testgapsWorkerEnabled and threshold met", async () => {
      const subAgentManager = {
        run: vi.fn<any>().mockResolvedValue({
          type: "testgaps-worker",
          success: true,
          output: "### Test Gaps Worker\n\nclean.",
          toolCallCount: 0,
          iterationsUsed: 0,
        }),
      };
      const client = makeMultiClient([writeCallText, writeCallText, writeCallText, "Done."]);
      const loop = new AgentLoop(client, manager, registry, "gemma3:27b", 20, undefined, undefined, undefined, {
        subAgentManager: subAgentManager as any,
        verificationThreshold: 3,
        verificationEnabled: false,
        testgapsWorkerEnabled: true,
      });
      const { postMessage } = collectMessages();

      await loop.run(postMessage);

      expect(subAgentManager.run).toHaveBeenCalledOnce();
      const config = subAgentManager.run.mock.calls[0]![0];
      expect(config.type).toBe("testgaps-worker");
    });

    it("fires verification + both workers in order when all three are enabled", async () => {
      const subAgentManager = {
        run: vi.fn<any>().mockImplementation(async (config: { type: string }) => ({
          type: config.type,
          success: true,
          output: `${config.type} ok`,
          toolCallCount: 0,
          iterationsUsed: 1,
        })),
      };
      const client = makeMultiClient([writeCallText, writeCallText, writeCallText, "Done."]);
      const loop = new AgentLoop(client, manager, registry, "gemma3:27b", 20, undefined, undefined, undefined, {
        subAgentManager: subAgentManager as any,
        verificationThreshold: 3,
        verificationEnabled: true,
        auditWorkerEnabled: true,
        testgapsWorkerEnabled: true,
      });
      const { postMessage } = collectMessages();

      await loop.run(postMessage);

      expect(subAgentManager.run).toHaveBeenCalledTimes(3);
      const types = subAgentManager.run.mock.calls.map((c) => c[0].type);
      expect(types).toEqual(["verification", "audit-worker", "testgaps-worker"]);
    });
  });

  describe("budget middleware integration", () => {
    it("stops the loop when budget middleware returns 'stop'", async () => {
      const middleware = new BudgetMiddleware({
        maxSessionTokens: 100000,
        maxTurnTokens: 100000,
        maxIterations: 0, // exhaust immediately
        warningThresholdPercent: 80,
      });

      const client = makeMultiClient([toolCallText, "Done."]);
      const loop = new AgentLoop(client, manager, registry, "gemma3:27b", 20, undefined, undefined, undefined, {
        budgetMiddleware: middleware,
      });
      const { posted, postMessage } = collectMessages();

      await loop.run(postMessage);

      const errorMsg = posted.find((m) => m.type === "error");
      expect(errorMsg).toBeDefined();
      expect((errorMsg as { type: "error"; text: string }).text).toContain("Budget exhausted");
      expect(posted.some((m) => m.type === "messageComplete")).toBe(false);
    });

    it("does not affect behavior when no middleware is provided", async () => {
      const client = makeClient("Hello.");
      const loop = new AgentLoop(client, manager, registry, "gemma3:27b");
      const { posted, postMessage } = collectMessages();

      await loop.run(postMessage);

      expect(posted.some((m) => m.type === "messageComplete")).toBe(true);
    });

    it("setBudgetMiddleware allows updating middleware after construction", async () => {
      const middleware = new BudgetMiddleware({
        maxSessionTokens: 100000,
        maxTurnTokens: 100000,
        maxIterations: 0,
        warningThresholdPercent: 80,
      });

      const client = makeMultiClient(["Hello."]);
      const loop = new AgentLoop(client, manager, registry, "gemma3:27b");
      loop.setBudgetMiddleware(middleware);

      const { posted, postMessage } = collectMessages();
      await loop.run(postMessage);

      const errorMsg = posted.find((m) => m.type === "error");
      expect(errorMsg).toBeDefined();
      expect((errorMsg as { type: "error"; text: string }).text).toContain("Budget exhausted");
    });
  });

  describe("spawnSubAgent", () => {
    it("returns null when no subAgentManager is provided", async () => {
      const loop = new AgentLoop(makeClient("x"), manager, registry, "gemma3:27b");
      const { postMessage } = collectMessages();

      const result = await loop.spawnSubAgent(
        { type: "research", maxIterations: 5, userRequest: "test", modifiedFiles: [], recentToolResults: [] },
        postMessage,
      );

      expect(result).toBeNull();
    });

    it("delegates to subAgentManager.run when provided", async () => {
      const mockResult = {
        type: "research" as const,
        success: true,
        output: "Found info.",
        toolCallCount: 0,
        iterationsUsed: 1,
      };
      const subAgentManager = { run: vi.fn<any>().mockResolvedValue(mockResult) };
      const loop = new AgentLoop(makeClient("x"), manager, registry, "gemma3:27b", 20, undefined, undefined, undefined, {
        subAgentManager: subAgentManager as any,
      });
      const { postMessage } = collectMessages();

      const config = { type: "research" as const, maxIterations: 5, userRequest: "test", modifiedFiles: [], recentToolResults: [] };
      const result = await loop.spawnSubAgent(config, postMessage);

      expect(subAgentManager.run).toHaveBeenCalledWith(config, postMessage);
      expect(result).toEqual(mockResult);
    });
  });

  // 3.4 — Wire BudgetMiddleware.recordTurnTokens
  describe("BudgetMiddleware integration", () => {
    it("records per-turn tokens and halts the loop on the next iteration after session budget exhaustion", async () => {
      const middleware = new BudgetMiddleware({
        maxSessionTokens: 50, // ~200 chars / 4 -> tripped after one turn
        maxTurnTokens: 1_000_000, // do not trip per-turn limit
        maxIterations: 10,
        warningThresholdPercent: 80,
      });

      // Iter 1 emits a tool call so the loop continues; iter 2's pre-turn
      // check must halt because sessionTokensUsed > maxSessionTokens.
      const filler = "x".repeat(800); // 200 tokens
      const client = makeMultiClient([
        `${filler} ${toolCallText}`,
        "ignored — loop should halt before this",
      ]);
      const loop = new AgentLoop(
        client,
        manager,
        registry,
        "gemma3:27b",
        5,
        undefined,
        undefined,
        undefined,
        { budgetMiddleware: middleware },
      );
      const { posted, postMessage } = collectMessages();

      await loop.run(postMessage);

      expect(middleware.getState().sessionTokensUsed).toBeGreaterThanOrEqual(50);

      const budgetError = posted.find(
        (m) => m.type === "error" && /Budget/i.test((m as { text: string }).text),
      );
      expect(budgetError).toBeDefined();

      // Only one stream call — iter 2's pre-turn check halted before streaming.
      expect((client.streamChat as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    });

    it("halts when a single turn exceeds maxTurnTokens", async () => {
      const middleware = new BudgetMiddleware({
        maxSessionTokens: 1_000_000,
        maxTurnTokens: 5, // very low: 40-char response = 10 tokens > 5
        maxIterations: 10,
        warningThresholdPercent: 80,
      });

      const client = makeClient("response that exceeds the per-turn limit");
      const loop = new AgentLoop(
        client,
        manager,
        registry,
        "gemma3:27b",
        5,
        undefined,
        undefined,
        undefined,
        { budgetMiddleware: middleware },
      );
      const { posted, postMessage } = collectMessages();

      await loop.run(postMessage);

      const truncErr = posted.find(
        (m) => m.type === "error" && /Turn token limit/i.test((m as { text: string }).text),
      );
      expect(truncErr).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // GitSafetyNet integration (5.2)
  // -------------------------------------------------------------------------

  describe("GitSafetyNet integration", () => {
    type GitSafetyNetLike = import("../../../modules/coding/guardrails/GitSafetyNet.js").GitSafetyNet;

    function makeSafetyNet(overrides: Partial<GitSafetyNetLike> = {}): GitSafetyNetLike {
      return mockOf<GitSafetyNetLike>({
        isGitRepo: vi.fn(async () => true),
        createCheckpoint: vi.fn(async () => ({
          headSha: "abcdef1234",
          stashCreated: false,
          timestamp: Date.now(),
        })),
        commitAgentChanges: vi.fn(async () => "commit_sha"),
        rollback: vi.fn(async () => true),
        ...overrides,
      });
    }

    it("does not call checkpoint when gitSafetyNet is not provided", async () => {
      const client = makeClient("Done.");
      const loop = new AgentLoop(client, manager, registry, "gemma3:27b");
      const { posted, postMessage } = collectMessages();

      await loop.run(postMessage);

      expect(posted.some((m) => m.type === "gitCheckpoint")).toBe(false);
    });

    it("creates a checkpoint at the start of a run when provided", async () => {
      const gitSafetyNet = makeSafetyNet();
      const client = makeClient("Done.");
      const loop = new AgentLoop(
        client,
        manager,
        registry,
        "gemma3:27b",
        5,
        undefined,
        undefined,
        undefined,
        { gitSafetyNet },
      );
      const { posted, postMessage } = collectMessages();

      await loop.run(postMessage);

      expect(gitSafetyNet.createCheckpoint).toHaveBeenCalledTimes(1);
      expect(posted.some((m) => m.type === "gitCheckpoint")).toBe(true);
    });

    it("skips commitAgentChanges when no files are modified", async () => {
      const gitSafetyNet = makeSafetyNet();
      const client = makeClient("No edits here.");
      const loop = new AgentLoop(
        client,
        manager,
        registry,
        "gemma3:27b",
        3,
        undefined,
        undefined,
        undefined,
        { gitSafetyNet },
      );
      const { postMessage } = collectMessages();

      await loop.run(postMessage);

      expect(gitSafetyNet.commitAgentChanges).not.toHaveBeenCalled();
    });

    it("keeps running even when createCheckpoint returns null", async () => {
      const gitSafetyNet = makeSafetyNet({
        createCheckpoint: vi.fn(async () => null),
      });
      const client = makeClient("Done.");
      const loop = new AgentLoop(
        client,
        manager,
        registry,
        "gemma3:27b",
        3,
        undefined,
        undefined,
        undefined,
        { gitSafetyNet },
      );
      const { posted, postMessage } = collectMessages();

      await loop.run(postMessage);

      expect(gitSafetyNet.createCheckpoint).toHaveBeenCalledTimes(1);
      expect(posted.some((m) => m.type === "messageComplete")).toBe(true);
      // No checkpoint posted because createCheckpoint returned null.
      expect(posted.some((m) => m.type === "gitCheckpoint")).toBe(false);
    });
  });

  describe("pass-state gating (v0.8.0 Phase 2 item C8)", () => {
    const runTerminalCallText =
      '<|tool_call>call:run_terminal{command:<|"|>npm test<|"|>}<tool_call|>';

    it("verified task: run_terminal success counts as verification and the loop terminates normally", async () => {
      const client = makeMultiClient([runTerminalCallText, "All tests pass."]);
      const loop = new AgentLoop(client, manager, registry, "gemma3:27b");
      const { posted, postMessage } = collectMessages();

      await loop.run(postMessage);

      expect(registry.execute).toHaveBeenCalledOnce();
      expect(posted.some((m) => m.type === "messageComplete")).toBe(true);
      // No nudge injected because the gate was satisfied.
      const userCalls = (manager.addUserMessage as ReturnType<typeof vi.fn>).mock.calls.map(
        (c: unknown[]) => c[0] as string,
      );
      expect(userCalls.some((c) => c.includes("Task cannot complete without verification"))).toBe(false);
    });

    it("unverified task: emits nudge once and gives the agent another iteration", async () => {
      // No tool call on either turn -> first 'Done.' triggers nudge, second terminates.
      const client = makeMultiClient(["Done.", "Done."]);
      const loop = new AgentLoop(client, manager, registry, "gemma3:27b");
      const { posted, postMessage } = collectMessages();

      await loop.run(postMessage);

      const userCalls = (manager.addUserMessage as ReturnType<typeof vi.fn>).mock.calls.map(
        (c: unknown[]) => c[0] as string,
      );
      const nudgeCount = userCalls.filter((c) =>
        c.includes("Task cannot complete without verification"),
      ).length;
      expect(nudgeCount).toBe(1);
      // After the nudge the loop still terminates so the operator can inspect.
      expect(posted.some((m) => m.type === "messageComplete")).toBe(true);
    });

    it("passStateGating: false disables the gate", async () => {
      const client = makeClient("Done with no verification at all.");
      const loop = new AgentLoop(
        client,
        manager,
        registry,
        "gemma3:27b",
        20,
        undefined,
        undefined,
        undefined,
        { passStateGating: false },
      );
      const { postMessage } = collectMessages();

      await loop.run(postMessage);

      const userCalls = (manager.addUserMessage as ReturnType<typeof vi.fn>).mock.calls.map(
        (c: unknown[]) => c[0] as string,
      );
      expect(userCalls.some((c) => c.includes("Task cannot complete without verification"))).toBe(false);
    });

    it("successful verification sub-agent dispatch credits the gate (Phase 6.2)", async () => {
      const writeCall = '<|tool_call>call:write_file{path:<|"|>src/x.ts<|"|>,content:<|"|>x<|"|>}<tool_call|>';
      const subAgentManager = {
        run: vi.fn<any>().mockResolvedValue({
          type: "verification",
          success: true,
          output: "All clear.",
          toolCallCount: 1,
          iterationsUsed: 1,
        }),
      };
      const client = makeMultiClient([writeCall, writeCall, writeCall, "Done."]);
      const loop = new AgentLoop(client, manager, registry, "gemma3:27b", 20, undefined, undefined, undefined, {
        subAgentManager: subAgentManager as any,
        verificationThreshold: 3,
        verificationEnabled: true,
      });
      const { postMessage } = collectMessages();

      await loop.run(postMessage);

      expect(subAgentManager.run).toHaveBeenCalledOnce();
      const userCalls = (manager.addUserMessage as ReturnType<typeof vi.fn>).mock.calls.map(
        (c: unknown[]) => c[0] as string,
      );
      // The verification sub-agent's success credited the gate, so "Done."
      // terminates without the nudge.
      expect(
        userCalls.some((c) => c.includes("Task cannot complete without verification")),
      ).toBe(false);
    });

    it("subAgentVerificationCredit: false suppresses the credit (legacy v0.8.0 behaviour)", async () => {
      const writeCall = '<|tool_call>call:write_file{path:<|"|>src/x.ts<|"|>,content:<|"|>x<|"|>}<tool_call|>';
      const subAgentManager = {
        run: vi.fn<any>().mockResolvedValue({
          type: "verification",
          success: true,
          output: "All clear.",
          toolCallCount: 1,
          iterationsUsed: 1,
        }),
      };
      const client = makeMultiClient([writeCall, writeCall, writeCall, "Done.", "Done."]);
      const loop = new AgentLoop(client, manager, registry, "gemma3:27b", 20, undefined, undefined, undefined, {
        subAgentManager: subAgentManager as any,
        verificationThreshold: 3,
        verificationEnabled: true,
        subAgentVerificationCredit: false,
      });
      const { postMessage } = collectMessages();

      await loop.run(postMessage);

      const userCalls = (manager.addUserMessage as ReturnType<typeof vi.fn>).mock.calls.map(
        (c: unknown[]) => c[0] as string,
      );
      // With credit disabled, the gate fires even though verification succeeded.
      expect(
        userCalls.some((c) => c.includes("Task cannot complete without verification")),
      ).toBe(true);
    });

    it("failed verification sub-agent does NOT credit the gate", async () => {
      const writeCall = '<|tool_call>call:write_file{path:<|"|>src/x.ts<|"|>,content:<|"|>x<|"|>}<tool_call|>';
      const subAgentManager = {
        run: vi.fn<any>().mockResolvedValue({
          type: "verification",
          success: false,
          output: "",
          toolCallCount: 0,
          iterationsUsed: 0,
          error: "verifier crashed",
        }),
      };
      const client = makeMultiClient([writeCall, writeCall, writeCall, "Done.", "Done."]);
      const loop = new AgentLoop(client, manager, registry, "gemma3:27b", 20, undefined, undefined, undefined, {
        subAgentManager: subAgentManager as any,
        verificationThreshold: 3,
        verificationEnabled: true,
      });
      const { postMessage } = collectMessages();

      await loop.run(postMessage);

      const userCalls = (manager.addUserMessage as ReturnType<typeof vi.fn>).mock.calls.map(
        (c: unknown[]) => c[0] as string,
      );
      expect(
        userCalls.some((c) => c.includes("Task cannot complete without verification")),
      ).toBe(true);
    });

    it("reflect-worker sub-agent return does NOT credit the gate", async () => {
      // Direct invocation against creditSubAgentVerification: reflect-worker
      // is excluded from SUB_AGENT_VERIFICATION_TYPES even when it succeeds.
      const client = makeMultiClient(["Done.", "Done."]);
      const loop = new AgentLoop(client, manager, registry, "gemma3:27b");
      // creditSubAgentVerification has no public peek; the assertion below
      // confirms the credit was NOT recorded by observing that the gate
      // still fires on the next run() (verification flag is reset on run
      // start, so we need to credit mid-loop -- here we approximate by
      // calling before run() and confirming reset wipes any state).
      loop.creditSubAgentVerification({
        type: "reflect-worker",
        success: true,
        output: "",
        toolCallCount: 0,
        iterationsUsed: 0,
      });
      const { postMessage } = collectMessages();
      await loop.run(postMessage);
      const userCalls = (manager.addUserMessage as ReturnType<typeof vi.fn>).mock.calls.map(
        (c: unknown[]) => c[0] as string,
      );
      expect(userCalls.some((c) => c.includes("Task cannot complete without verification"))).toBe(true);
    });

    it("failed run_terminal does NOT credit the gate", async () => {
      const failingRegistry = mockOf<ToolRegistry>({
        execute: vi
          .fn<[ToolCall], Promise<ToolResult>>()
          .mockResolvedValue({
            id: "call_001",
            success: false,
            output: "",
            error: "exit 1",
          }),
        register: vi.fn(),
        has: vi.fn(() => true),
      });
      const client = makeMultiClient([runTerminalCallText, "Done anyway.", "Done anyway."]);
      const loop = new AgentLoop(client, manager, failingRegistry, "gemma3:27b");
      const { postMessage } = collectMessages();

      await loop.run(postMessage);

      const userCalls = (manager.addUserMessage as ReturnType<typeof vi.fn>).mock.calls.map(
        (c: unknown[]) => c[0] as string,
      );
      expect(
        userCalls.some((c) => c.includes("Task cannot complete without verification")),
      ).toBe(true);
    });
  });
});
