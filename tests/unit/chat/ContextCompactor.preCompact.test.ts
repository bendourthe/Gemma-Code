import { describe, it, expect, vi } from "vitest";
import { ContextCompactor } from "../../../modules/coding/chat/ContextCompactor.js";
import type { ConversationManager } from "../../../modules/coding/chat/ConversationManager.js";
import type { HookBus, LifecycleEvent } from "../../../core/lifecycle/HookBus.js";
import { makeOllamaClient, mockOf } from "../../helpers/factories.js";

// v1.5.0 Phase 4 (T013, closes v1.4.0 T016.P3.A): the ContextCompactor emits
// `lifecycle.context.preCompact` at the real compaction boundary so the A8
// PreCompact WIP hook (attached at session bootstrap) fires. The emit must
// happen only when a compaction actually runs, and never break compaction.

function makeManager(): ConversationManager {
  const history = [
    { id: "m0", role: "system" as const, content: "system prompt", timestamp: 1 },
    { id: "m1", role: "user" as const, content: "hello world ".repeat(30), timestamp: 2 },
    { id: "m2", role: "assistant" as const, content: "a reply ".repeat(30), timestamp: 3 },
  ];
  return mockOf<ConversationManager>({
    getHistory: () => history,
    replayForCompaction: () => history,
    replaceMessages: vi.fn(),
    dispose: vi.fn(),
    sessionId: "sess-1",
  });
}

function captureBus(): { bus: HookBus; events: LifecycleEvent[] } {
  const events: LifecycleEvent[] = [];
  const bus: HookBus = {
    emit: (e) => {
      events.push(e);
    },
    on: () => ({ dispose: () => {} }),
    onAny: () => ({ dispose: () => {} }),
  };
  return { bus, events };
}

describe("ContextCompactor PreCompact emit (T013)", () => {
  it("emits lifecycle.context.preCompact when a hookBus is wired and a forced compaction runs", async () => {
    const { bus, events } = captureBus();
    const compactor = new ContextCompactor(makeManager(), makeOllamaClient(""), "gemma4", 100);
    compactor.setHookBus(bus);

    await compactor.compact(vi.fn(), true);

    const pre = events.filter((e) => e.kind === "lifecycle.context.preCompact");
    expect(pre).toHaveLength(1);
    const event = pre[0] as Extract<LifecycleEvent, { kind: "lifecycle.context.preCompact" }>;
    expect(event.sessionId).toBe("sess-1");
    expect(event.beforeTokens).toBeGreaterThan(0);
    expect(event.afterTokens).toBeGreaterThan(0);
  });

  it("does not emit when below threshold and not forced (no-op compaction)", async () => {
    const { bus, events } = captureBus();
    const compactor = new ContextCompactor(
      makeManager(),
      makeOllamaClient(""),
      "gemma4",
      1_000_000,
    );
    compactor.setHookBus(bus);

    await compactor.compact(vi.fn(), false);

    expect(events.filter((e) => e.kind === "lifecycle.context.preCompact")).toHaveLength(0);
  });

  it("does not throw when no hookBus is wired", async () => {
    const compactor = new ContextCompactor(makeManager(), makeOllamaClient(""), "gemma4", 100);
    await expect(compactor.compact(vi.fn(), true)).resolves.toBeDefined();
  });
});
