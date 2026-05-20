import { describe, it, expect, beforeEach } from "vitest";
import { AgentLoop } from "../../../src/tools/AgentLoop.js";
import {
  InProcessHookBus,
  type LifecycleEvent,
} from "../../../core/lifecycle/HookBus.js";
import { Tracer } from "../../../src/observability/Tracer.js";
import { TraceStore } from "../../../src/observability/TraceStore.js";
import type { ConversationManager } from "../../../src/chat/ConversationManager.js";
import type { ToolRegistry } from "../../../src/tools/ToolRegistry.js";
import {
  collectMessages,
  makeConversationManager as makeManager,
  makeMultiResponseOllamaClient as makeMultiClient,
  makeToolRegistry as makeRegistry,
} from "../../helpers/factories.js";

/**
 * v1.1.0 Phase 8.5 -- AgentLoop.setCurrentSkill integration.
 *
 * Asserts:
 *   (a) setting a current skill emits `lifecycle.skill.entry` on the HookBus;
 *   (b) clearing (`setCurrentSkill(null)`) does NOT emit a second entry;
 *   (c) tool_call spans that fire while a skill is active carry the
 *       `skill.id` and `skill.namespace` attributes via the Tracer's
 *       existing fold-on-start behaviour.
 */

const toolCallText =
  '<|tool_call>call:read_file{path:<|"|>src/extension.ts<|"|>}<tool_call|>';

describe("AgentLoop.setCurrentSkill (Phase 8.5)", () => {
  let manager: ConversationManager;
  let registry: ToolRegistry;

  beforeEach(() => {
    manager = makeManager();
    registry = makeRegistry();
  });

  it("emits lifecycle.skill.entry when a skill is set", () => {
    const hookBus = new InProcessHookBus();
    const events: LifecycleEvent[] = [];
    hookBus.onAny((ev) => events.push(ev));

    const loop = new AgentLoop(
      makeMultiClient(["Done."]),
      manager,
      registry,
      "gemma3:27b",
      undefined,
      undefined,
      undefined,
      undefined,
      { sessionId: "sess-skill-1", hookBus },
    );

    loop.setCurrentSkill({
      id: "devai-hub/code-quality",
      namespace: "devai-hub",
      tag: "v1.3.2",
    });

    const skillEntries = events.filter((e) => e.kind === "lifecycle.skill.entry");
    expect(skillEntries).toHaveLength(1);
    const ev = skillEntries[0] as Extract<
      LifecycleEvent,
      { kind: "lifecycle.skill.entry" }
    >;
    expect(ev.sessionId).toBe("sess-skill-1");
    expect(ev.skillId).toBe("devai-hub/code-quality");
    expect(ev.namespace).toBe("devai-hub");
  });

  it("does not emit on clear (setCurrentSkill(null) is a no-op for the bus)", () => {
    const hookBus = new InProcessHookBus();
    const events: LifecycleEvent[] = [];
    hookBus.onAny((ev) => events.push(ev));

    const loop = new AgentLoop(
      makeMultiClient(["Done."]),
      manager,
      registry,
      "gemma3:27b",
      undefined,
      undefined,
      undefined,
      undefined,
      { sessionId: "sess-skill-2", hookBus },
    );

    loop.setCurrentSkill({
      id: "user/lonely",
      namespace: "user",
    });
    loop.setCurrentSkill(null);
    const entries = events.filter((e) => e.kind === "lifecycle.skill.entry");
    expect(entries).toHaveLength(1);
  });

  it("tool_call spans carry skill provenance attributes while a skill is active", async () => {
    const tracer = new Tracer();
    const store = new TraceStore(":memory:");
    tracer.init(store);

    const loop = new AgentLoop(
      makeMultiClient([toolCallText, "Done."]),
      manager,
      registry,
      "gemma3:27b",
      undefined,
      undefined,
      undefined,
      undefined,
      { sessionId: "sess-skill-3", tracer },
    );

    loop.setCurrentSkill({
      id: "user/code-quality",
      namespace: "user",
    });

    const { postMessage } = collectMessages();
    await loop.run(postMessage);

    const traceId = loop.getTraceId();
    expect(traceId).toBeTruthy();
    store.flush();
    const toolSpans = store.getSpansByKind(traceId, "tool_call");
    expect(toolSpans.length).toBeGreaterThan(0);
    for (const span of toolSpans) {
      expect(span.attributes["skill.id"]).toBe("user/code-quality");
      expect(span.attributes["skill.namespace"]).toBe("user");
    }
    store.close();
  });

  it("operates without a HookBus or sessionId (silent path)", () => {
    const loop = new AgentLoop(
      makeMultiClient(["Done."]),
      manager,
      registry,
      "gemma3:27b",
    );
    // Should not throw, no events to assert.
    expect(() =>
      loop.setCurrentSkill({ id: "user/x", namespace: "user" }),
    ).not.toThrow();
    expect(() => loop.setCurrentSkill(null)).not.toThrow();
  });
});
