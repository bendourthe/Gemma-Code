/**
 * Integration test: plan-archive revise-then-diff flow.
 *
 * v0.8.0 Phase 3.2 -- when an agent emits a revised plan after denial, the
 * controller must (a) append the new revision to `PlanArchive`, (b) compute
 * the 3-mode diff against the prior version, and (c) emit a `renderPlanDiff`
 * message to the webview. The legacy `planReady` message must continue to
 * fire for the unchanged downstream listeners.
 *
 * The test uses a fake archive + a partial {@link ChatControllerContext} so
 * we exercise the real controller path (`_checkForPlan`) without spinning up
 * the full agent loop / streaming pipeline.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatController } from "../../../src/panels/ChatController.js";
import type { ChatControllerContext } from "../../../src/panels/ChatController.js";
import { PlanArchive } from "../../../src/storage/PlanArchive.js";
import { PlanMode } from "../../../src/chat/PlanMode.js";
import type { ExtensionToWebviewMessage } from "../../../src/panels/messages.js";

type AssistantMessage = { role: "assistant"; content: string };

function makeContext(
  archive: PlanArchive,
  history: AssistantMessage[],
  posted: ExtensionToWebviewMessage[],
): ChatControllerContext {
  const planMode = new PlanMode();
  planMode.toggle();
  const stub = {} as unknown;
  const manager = {
    getHistory: () => history,
    sessionId: "session-42",
  };
  return {
    manager: manager as never,
    planMode,
    promptBuilder: stub as never,
    compactor: stub as never,
    commandRouter: stub as never,
    runtime: stub as never,
    subAgentManager: stub as never,
    agentLoop: stub as never,
    pipeline: stub as never,
    orchestrator: stub as never,
    skillLoader: stub as never,
    planArchive: archive,
    getStore: () => null,
    getMemoryStore: () => null,
    getMemoryFiles: () => null,
    getToolOutputCache: () => null,
    getOperationLog: () => null,
    getCompressionState: () => null,
    getMcpManager: () => null,
    getMcpTools: () => [],
    setMcpTools: vi.fn(),
    getUnifiedRetriever: () => null,
    getSettings: () => stub as never,
    buildPromptContext: () => stub as never,
    postMessage: (msg) => {
      posted.push(msg);
    },
    postHistory: vi.fn(),
    postTokenCount: vi.fn(),
    postMemoryStatus: vi.fn(),
    postMcpStatus: vi.fn(),
  };
}

describe("ChatController plan revise-then-diff flow (v0.8.0 Phase 3.2)", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "plan-archive-int-"));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("first plan version archives without emitting a diff; second version emits renderPlanDiff", () => {
    const archive = new PlanArchive({ rootDir: root, workspaceId: "ws" });
    const posted: ExtensionToWebviewMessage[] = [];
    const history: AssistantMessage[] = [
      {
        role: "assistant",
        content: "1. Read the file\n2. Apply edits\n",
      },
    ];
    const ctx = makeContext(archive, history, posted);
    const controller = new ChatController(ctx);

    (controller as unknown as { _checkForPlan: () => void })._checkForPlan();
    expect(posted.find((m) => m.type === "planReady")).toBeTruthy();
    expect(posted.find((m) => m.type === "renderPlanDiff")).toBeUndefined();
    expect(archive.listVersions("session-42")).toHaveLength(1);

    // Agent revises the plan after a denial; the assistant message changes
    // and `_checkForPlan` is invoked again.
    history.length = 0;
    history.push({
      role: "assistant",
      content: "1. Read the file\n2. Apply edits\n3. Run tests\n",
    });
    posted.length = 0;
    (controller as unknown as { _checkForPlan: () => void })._checkForPlan();

    const diffMessage = posted.find(
      (m): m is Extract<ExtensionToWebviewMessage, { type: "renderPlanDiff" }> =>
        m.type === "renderPlanDiff",
    );
    expect(diffMessage).toBeTruthy();
    expect(diffMessage?.planSlug).toBe("session-42");
    expect(diffMessage?.fromVersion).toBe(1);
    expect(diffMessage?.toVersion).toBe(2);
    expect(diffMessage?.classic).toContain("+3. Run tests");
    expect(diffMessage?.raw).toContain("--- session-42.md");

    expect(archive.listVersions("session-42")).toHaveLength(2);
  });

  it("emits no diff when the plan content is identical to the prior version", () => {
    const archive = new PlanArchive({ rootDir: root, workspaceId: "ws" });
    const posted: ExtensionToWebviewMessage[] = [];
    const history: AssistantMessage[] = [
      { role: "assistant", content: "1. A\n2. B\n" },
    ];
    const ctx = makeContext(archive, history, posted);
    const controller = new ChatController(ctx);

    (controller as unknown as { _checkForPlan: () => void })._checkForPlan();
    posted.length = 0;
    (controller as unknown as { _checkForPlan: () => void })._checkForPlan();

    const diff = posted.find(
      (m): m is Extract<ExtensionToWebviewMessage, { type: "renderPlanDiff" }> =>
        m.type === "renderPlanDiff",
    );
    // The diff message still fires for v2 vs v1, but the classic body has
    // no add/del rows (every line is context).
    expect(diff).toBeTruthy();
    const classic = diff?.classic ?? "";
    const hasAddOrDel = classic
      .split("\n")
      .some((l) => l.startsWith("+") || l.startsWith("-"));
    expect(hasAddOrDel).toBe(false);
  });
});
