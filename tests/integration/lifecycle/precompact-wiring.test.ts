import { describe, it, expect, vi } from "vitest";
import {
  InProcessHookBus,
  type LifecycleNotificationEvent,
} from "../../../core/lifecycle/HookBus.js";
import { attachPreCompactWipHook } from "../../../core/lifecycle/PreCompactHook.js";
import { ContextCompactor } from "../../../modules/coding/chat/ContextCompactor.js";
import type { ConversationManager } from "../../../modules/coding/chat/ConversationManager.js";
import { makeOllamaClient, mockOf } from "../../helpers/factories.js";

// v1.5.0 Phase 4 (T013, closes v1.4.0 T016.P3.A): production-path proof that the
// A8 PreCompact WIP hook fires on a real compaction. The bootstrap attaches the
// hook to the session HookBus and wires the same bus into the ContextCompactor;
// here we reproduce that wiring and drive a forced compaction, asserting the
// hook persists a checkpoint and warns -- without blocking the compaction.

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

describe("integration: PreCompact WIP hook fires on a real compaction (T013)", () => {
  it("persists a checkpoint and warns (non-blocking) when WIP is present", async () => {
    const bus = new InProcessHookBus(null);
    const writes: Array<{ path: string; content: string }> = [];
    const notifications: LifecycleNotificationEvent[] = [];
    bus.on("lifecycle.notification", (e) => notifications.push(e));

    attachPreCompactWipHook(bus, {
      homeDir: "/fake/nexus-home",
      gitStatus: () => " M src/x.ts\n",
      writeFile: (p, c) => writes.push({ path: p, content: c }),
      mkdir: () => {},
      now: () => new Date("2026-06-11T00:00:00.000Z"),
    });

    const compactor = new ContextCompactor(makeManager(), makeOllamaClient(""), "gemma4", 100);
    compactor.setHookBus(bus);

    const result = await compactor.compact(vi.fn(), true);

    // The compaction completed -- the fire-and-forget hook did not block it.
    expect(result).toBeDefined();
    // A restorable checkpoint was written for the session.
    expect(writes).toHaveLength(1);
    expect(writes[0]!.path).toMatch(/sess-1\.json$/);
    // A non-blocking warning surfaced the in-flight work.
    expect(notifications).toHaveLength(1);
    expect(notifications[0]!.severity).toBe("warning");
    expect(notifications[0]!.notificationKind).toBe("context.preCompact.wip");
  });

  it("persists a checkpoint but emits no warning when the tree is clean", async () => {
    const bus = new InProcessHookBus(null);
    const writes: string[] = [];
    const notifications: LifecycleNotificationEvent[] = [];
    bus.on("lifecycle.notification", (e) => notifications.push(e));

    attachPreCompactWipHook(bus, {
      homeDir: "/fake/nexus-home",
      gitStatus: () => "",
      writeFile: (p) => writes.push(p),
      mkdir: () => {},
      now: () => new Date("2026-06-11T00:00:00.000Z"),
    });

    const compactor = new ContextCompactor(makeManager(), makeOllamaClient(""), "gemma4", 100);
    compactor.setHookBus(bus);

    await compactor.compact(vi.fn(), true);

    expect(writes).toHaveLength(1);
    expect(notifications).toHaveLength(0);
  });
});
