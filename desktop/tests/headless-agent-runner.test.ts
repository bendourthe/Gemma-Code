/**
 * v1.7.0 -- the desktop sidecar Coding pillar now drives a real headless agent
 * (SO001.P1.A runtime) instead of the Phase 3.1 canned placeholder. These tests
 * prove (a) the runner maps HeadlessAgentSession events onto the sidecar's
 * CodingSessionEvent IPC union and scopes tools to the session workspace, and
 * (b) CodingSessionManager delegates to an injected runner while preserving the
 * canned fallback when none is wired.
 */

import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { LLMClient } from "../../modules/coding/llm/types";
import {
  createHeadlessAgentRunner,
  type AgentRunnerInput,
} from "../sidecar/src/coding/headlessAgentRunner";
import { CodingSessionManager } from "../sidecar/src/coding/sessionManager";
import { requireModel } from "../sidecar/src/coding/models";

let workspace: string;

beforeEach(async () => {
  workspace = await fsp.mkdtemp(path.join(os.tmpdir(), "nexus-sidecar-agent-"));
});
afterEach(async () => {
  await fsp.rm(workspace, { recursive: true, force: true });
});

function toolCall(name: string, args: Record<string, string>): string {
  const body = Object.entries(args)
    .map(([k, v]) => `${k}:<|"|>${v}<|"|>`)
    .join("");
  return `<|tool_call>call:${name}{${body}}<tool_call|>`;
}

function scriptedLlm(responses: string[]): LLMClient {
  let i = 0;
  return {
    async checkHealth() {
      return true;
    },
    async listModels() {
      return [];
    },
    async *streamChat() {
      const text = responses[i++] ?? "Done.";
      yield { message: { role: "assistant", content: text }, done: true };
    },
  };
}

describe("createHeadlessAgentRunner", () => {
  it("maps a real agent turn onto the CodingSessionEvent IPC union, scoped to the session workspace", async () => {
    const runner = createHeadlessAgentRunner({
      llm: scriptedLlm([
        toolCall("write_file", { path: "note.txt", content: "hello" }),
        "Wrote it. Done.",
      ]),
    });

    const input: AgentRunnerInput = {
      sessionId: "s1",
      message: "create note.txt",
      model: requireModel("gemma4:e4b"),
      workspacePath: workspace,
    };
    const events = await runner(input);

    const kinds = events.map((e) => e.kind);
    expect(kinds).toContain("token");
    expect(kinds).toContain("toolCallHeader");
    expect(kinds).toContain("toolCallArgDelta");
    expect(kinds).toContain("toolCallComplete");
    expect(events.at(-1)).toEqual({ kind: "done", finishReason: "done" });

    // header + argDelta + complete share the same synthesized callId.
    const header = events.find((e) => e.kind === "toolCallHeader");
    const complete = events.find((e) => e.kind === "toolCallComplete");
    expect(header && "callId" in header ? header.callId : "a").toBe(
      complete && "callId" in complete ? complete.callId : "b",
    );

    // The tool actually ran against the session workspace.
    expect(await fsp.readFile(path.join(workspace, "note.txt"), "utf8")).toBe("hello");
  });

  it("never throws -- an LLM failure ends with a done event", async () => {
    const failing: LLMClient = {
      async checkHealth() {
        return true;
      },
      async listModels() {
        return [];
      },
      // eslint-disable-next-line require-yield
      async *streamChat() {
        throw new Error("stream down");
      },
    };
    const runner = createHeadlessAgentRunner({ llm: failing, workspace });
    const events = await runner({
      sessionId: "s",
      message: "x",
      model: requireModel("gemma4:e4b"),
    });
    expect(events.at(-1)?.kind).toBe("done");
  });
});

describe("CodingSessionManager.sendMessage delegation", () => {
  it("delegates to an injected agent runner and forwards the session workspace", async () => {
    const seen: AgentRunnerInput[] = [];
    const manager = new CodingSessionManager({
      agentRunner: async (input) => {
        seen.push(input);
        return [{ kind: "token", text: "REAL" }, { kind: "done" }];
      },
    });
    const started = manager.start({ modelId: "gemma4:e4b", workspacePath: "/proj/root" });
    const events = await manager.sendMessage(started.sessionId, "hi");
    expect(events).toEqual([{ kind: "token", text: "REAL" }, { kind: "done" }]);
    expect(seen[0]?.workspacePath).toBe("/proj/root");
  });

  it("falls back to the deterministic placeholder when no runner is wired", async () => {
    const manager = new CodingSessionManager();
    const started = manager.start({ modelId: "gemma4:e4b" });
    const events = await manager.sendMessage(started.sessionId, "hi");
    expect(events.some((e) => e.kind === "toolCallHeader")).toBe(true);
    expect(events.at(-1)?.kind).toBe("done");
  });
});
