import { describe, it, expect, beforeEach } from "vitest";
import { AgentLoop } from "../../../src/tools/AgentLoop.js";
import {
  InProcessHookBus,
  type LifecycleEvent,
} from "../../../core/lifecycle/HookBus.js";
import type { ConversationManager } from "../../../src/chat/ConversationManager.js";
import type { ToolRegistry } from "../../../src/tools/ToolRegistry.js";
import {
  collectMessages,
  makeConversationManager as makeManager,
  makeMultiResponseOllamaClient as makeMultiClient,
  makeOllamaClient as makeClient,
  makeToolRegistry as makeRegistry,
} from "../../helpers/factories.js";

/**
 * v1.1.0 Phase 4.3 -- AgentLoop lifecycle-event integration tests.
 *
 * Confirms that the loop emits the expected lifecycle stream around a
 * synthetic session. The exact event count varies with the test
 * scenario, but the bracketing rules are invariant: every run is
 * book-ended by `session.start` and `session.stop`; every tool call
 * is bracketed by `tool.pre` and `tool.post`.
 */

const toolCallText =
  '<|tool_call>call:read_file{path:<|"|>src/extension.ts<|"|>}<tool_call|>';

describe("AgentLoop -- HookBus integration (Phase 4.3)", () => {
  let manager: ConversationManager;
  let registry: ToolRegistry;

  beforeEach(() => {
    manager = makeManager();
    registry = makeRegistry();
  });

  it("emits session.start then session.stop around a no-tool turn", async () => {
    const client = makeClient("Here is my answer.");
    const hookBus = new InProcessHookBus();
    const events: LifecycleEvent[] = [];
    hookBus.onAny((ev) => events.push(ev));

    const loop = new AgentLoop(
      client,
      manager,
      registry,
      "gemma3:27b",
      undefined,
      undefined,
      undefined,
      undefined,
      { sessionId: "sess-test-1", hookBus },
    );
    const { postMessage } = collectMessages();
    await loop.run(postMessage);

    const kinds = events.map((e) => e.kind);
    expect(kinds[0]).toBe("lifecycle.session.start");
    expect(kinds[kinds.length - 1]).toBe("lifecycle.session.stop");

    const start = events[0] as Extract<
      LifecycleEvent,
      { kind: "lifecycle.session.start" }
    >;
    expect(start.sessionId).toBe("sess-test-1");
    expect(start.modelId).toBe("gemma3:27b");
    const stop = events[events.length - 1] as Extract<
      LifecycleEvent,
      { kind: "lifecycle.session.stop" }
    >;
    expect(stop.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("brackets a tool call with tool.pre and tool.post", async () => {
    const client = makeMultiClient([toolCallText, "Done."]);
    const hookBus = new InProcessHookBus();
    const events: LifecycleEvent[] = [];
    hookBus.onAny((ev) => events.push(ev));

    const loop = new AgentLoop(
      client,
      manager,
      registry,
      "gemma3:27b",
      undefined,
      undefined,
      undefined,
      undefined,
      { sessionId: "sess-test-2", hookBus },
    );
    const { postMessage } = collectMessages();
    await loop.run(postMessage);

    const kinds = events.map((e) => e.kind);
    const preIdx = kinds.indexOf("lifecycle.tool.pre");
    const postIdx = kinds.indexOf("lifecycle.tool.post");
    expect(preIdx).toBeGreaterThan(-1);
    expect(postIdx).toBeGreaterThan(preIdx);

    const pre = events[preIdx] as Extract<
      LifecycleEvent,
      { kind: "lifecycle.tool.pre" }
    >;
    expect(pre.sessionId).toBe("sess-test-2");
    expect(typeof pre.toolName).toBe("string");
    expect(pre.toolName.length).toBeGreaterThan(0);

    const post = events[postIdx] as Extract<
      LifecycleEvent,
      { kind: "lifecycle.tool.post" }
    >;
    expect(post.ok).toBeDefined();
    expect(post.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("does not emit when no hookBus is provided (legacy behavior)", async () => {
    const client = makeClient("Here is my answer.");
    const loop = new AgentLoop(
      client,
      manager,
      registry,
      "gemma3:27b",
      undefined,
      undefined,
      undefined,
      undefined,
      { sessionId: "sess-no-bus" },
    );
    const { postMessage } = collectMessages();
    // Should complete without throwing -- the hookBus path is gated.
    await expect(loop.run(postMessage)).resolves.not.toThrow();
  });
});
