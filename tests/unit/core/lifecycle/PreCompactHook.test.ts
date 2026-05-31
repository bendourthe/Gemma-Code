import { describe, it, expect } from "vitest";
import {
  InProcessHookBus,
  type LifecycleContextPreCompactEvent,
  type LifecycleNotificationEvent,
} from "../../../../core/lifecycle/HookBus.js";
import {
  attachPreCompactWipHook,
  detectWip,
  parseGitStatus,
  buildCheckpoint,
  renderWipWarning,
  readCompactionCheckpoint,
  checkpointPath,
  type CompactionCheckpoint,
} from "../../../../core/lifecycle/PreCompactHook.js";

/**
 * v1.4.0 Phase 5 (A8) -- PreCompact WIP hook tests.
 *
 * The acceptance criterion is: the hook fires on the PreCompact event and
 * warns WITHOUT blocking compaction. The bus is fire-and-forget, so "does
 * not block" is proven by emit() returning normally and the compaction
 * caller retaining control regardless of what the hook does.
 */

function preCompactEvent(
  overrides: Partial<LifecycleContextPreCompactEvent> = {},
): LifecycleContextPreCompactEvent {
  return {
    kind: "lifecycle.context.preCompact",
    sessionId: "sess-pc-1",
    beforeTokens: 8192,
    afterTokens: 4096,
    ...overrides,
  };
}

const CLEAN_OPTS = {
  homeDir: "/fake/nexus-home",
  gitStatus: () => "",
  inFlightTasks: () => [],
  writeFile: () => {},
  mkdir: () => {},
  now: () => new Date("2026-05-30T12:00:00.000Z"),
};

describe("parseGitStatus", () => {
  it("extracts changed paths and strips status codes", () => {
    const out = parseGitStatus(" M src/a.ts\n?? new.txt\nA  added.ts\n");
    expect(out).toEqual(["src/a.ts", "new.txt", "added.ts"]);
  });

  it("resolves the rename arrow form to the new path", () => {
    const out = parseGitStatus('R  "old name.ts" -> "new name.ts"\n');
    expect(out).toEqual(["new name.ts"]);
  });

  it("returns an empty array for clean output", () => {
    expect(parseGitStatus("")).toEqual([]);
    expect(parseGitStatus("\n  \n")).toEqual([]);
  });
});

describe("detectWip", () => {
  it("reports no WIP for a clean tree and no in-flight tasks", () => {
    const wip = detectWip({ gitStatus: () => "", inFlightTasks: () => [] });
    expect(wip.hasWip).toBe(false);
    expect(wip.uncommittedFiles).toEqual([]);
  });

  it("reports WIP from uncommitted files", () => {
    const wip = detectWip({ gitStatus: () => " M a.ts\n M b.ts\n", inFlightTasks: () => [] });
    expect(wip.hasWip).toBe(true);
    expect(wip.uncommittedFiles).toEqual(["a.ts", "b.ts"]);
  });

  it("reports WIP from in-flight tasks alone", () => {
    const wip = detectWip({ gitStatus: () => "", inFlightTasks: () => ["refactor auth"] });
    expect(wip.hasWip).toBe(true);
    expect(wip.inFlightTasks).toEqual(["refactor auth"]);
  });

  it("degrades to no-WIP when the git probe throws", () => {
    const wip = detectWip({
      gitStatus: () => {
        throw new Error("git not found");
      },
      inFlightTasks: () => [],
    });
    expect(wip.hasWip).toBe(false);
  });
});

describe("buildCheckpoint / renderWipWarning", () => {
  it("carries the token counts and WIP into the checkpoint", () => {
    const wip = { uncommittedFiles: ["a.ts"], inFlightTasks: [], hasWip: true };
    const cp = buildCheckpoint(preCompactEvent(), wip, "2026-05-30T12:00:00.000Z");
    expect(cp.beforeTokens).toBe(8192);
    expect(cp.afterTokens).toBe(4096);
    expect(cp.sessionId).toBe("sess-pc-1");
    expect(cp.wip).toEqual(wip);
  });

  it("renders a warning naming uncommitted files and in-flight tasks", () => {
    const msg = renderWipWarning({
      uncommittedFiles: ["a.ts", "b.ts"],
      inFlightTasks: ["task one"],
      hasWip: true,
    });
    expect(msg).toContain("Uncommitted edits (2)");
    expect(msg).toContain("a.ts");
    expect(msg).toContain("In-flight tasks (1)");
    expect(msg).toContain("task one");
  });

  it("caps the sampled file list in the warning", () => {
    const files = Array.from({ length: 25 }, (_, i) => `f${i}.ts`);
    const msg = renderWipWarning({ uncommittedFiles: files, inFlightTasks: [], hasWip: true }, 10);
    expect(msg).toContain("+15 more");
  });
});

describe("attachPreCompactWipHook", () => {
  it("fires on the PreCompact event and writes a checkpoint", () => {
    const bus = new InProcessHookBus(null);
    const writes: Array<{ path: string; content: string }> = [];
    const dirs: string[] = [];
    attachPreCompactWipHook(bus, {
      ...CLEAN_OPTS,
      gitStatus: () => " M src/x.ts\n",
      writeFile: (p, c) => writes.push({ path: p, content: c }),
      mkdir: (d) => dirs.push(d),
    });

    bus.emit(preCompactEvent());

    expect(dirs).toEqual([expect.stringMatching(/[\\/]checkpoints$/)]);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.path).toMatch(/sess-pc-1\.json$/);
    const cp = JSON.parse(writes[0]!.content) as CompactionCheckpoint;
    expect(cp.wip.uncommittedFiles).toEqual(["src/x.ts"]);
    expect(cp.beforeTokens).toBe(8192);
  });

  it("emits a non-blocking warning notification when WIP is present", () => {
    const bus = new InProcessHookBus(null);
    const notifications: LifecycleNotificationEvent[] = [];
    bus.on("lifecycle.notification", (e) => notifications.push(e));
    attachPreCompactWipHook(bus, { ...CLEAN_OPTS, gitStatus: () => " M a.ts\n" });

    // emit() returning normally is the proof the hook does not block compaction.
    expect(() => bus.emit(preCompactEvent())).not.toThrow();
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.severity).toBe("warning");
    expect(notifications[0]?.notificationKind).toBe("context.preCompact.wip");
    expect(notifications[0]?.message).toContain("a.ts");
  });

  it("writes a checkpoint but emits no warning on a clean tree", () => {
    const bus = new InProcessHookBus(null);
    const notifications: LifecycleNotificationEvent[] = [];
    const writes: string[] = [];
    bus.on("lifecycle.notification", (e) => notifications.push(e));
    attachPreCompactWipHook(bus, { ...CLEAN_OPTS, writeFile: (p) => writes.push(p) });

    bus.emit(preCompactEvent());
    expect(notifications).toHaveLength(0);
    expect(writes).toHaveLength(1);
  });

  it("does not fire for other event kinds", () => {
    const bus = new InProcessHookBus(null);
    const writes: string[] = [];
    attachPreCompactWipHook(bus, { ...CLEAN_OPTS, writeFile: (p) => writes.push(p) });
    bus.emit({ kind: "lifecycle.session.end", sessionId: "s" });
    expect(writes).toHaveLength(0);
  });

  it("never throws even when the checkpoint write fails", () => {
    const bus = new InProcessHookBus(null);
    attachPreCompactWipHook(bus, {
      ...CLEAN_OPTS,
      gitStatus: () => " M a.ts\n",
      writeFile: () => {
        throw new Error("disk full");
      },
    });
    // A failed checkpoint must not block compaction; the warning still fires.
    const notifications: LifecycleNotificationEvent[] = [];
    bus.on("lifecycle.notification", (e) => notifications.push(e));
    expect(() => bus.emit(preCompactEvent())).not.toThrow();
    expect(notifications).toHaveLength(1);
  });

  it("Disposable.dispose() unsubscribes the hook", () => {
    const bus = new InProcessHookBus(null);
    const writes: string[] = [];
    const disposable = attachPreCompactWipHook(bus, {
      ...CLEAN_OPTS,
      writeFile: (p) => writes.push(p),
    });
    bus.emit(preCompactEvent());
    disposable.dispose();
    bus.emit(preCompactEvent({ sessionId: "should-not-fire" }));
    expect(writes).toHaveLength(1);
  });
});

describe("readCompactionCheckpoint", () => {
  it("round-trips a written checkpoint", () => {
    const store = new Map<string, string>();
    const bus = new InProcessHookBus(null);
    attachPreCompactWipHook(bus, {
      ...CLEAN_OPTS,
      gitStatus: () => " M a.ts\n",
      writeFile: (p, c) => store.set(p, c),
    });
    bus.emit(preCompactEvent());

    const restored = readCompactionCheckpoint("sess-pc-1", {
      homeDir: "/fake/nexus-home",
      readFile: (p) => {
        const v = store.get(p);
        if (v === undefined) throw new Error("ENOENT");
        return v;
      },
    });
    expect(restored?.sessionId).toBe("sess-pc-1");
    expect(restored?.wip.uncommittedFiles).toEqual(["a.ts"]);
  });

  it("returns null when no checkpoint exists", () => {
    const restored = readCompactionCheckpoint("missing", {
      homeDir: "/fake",
      readFile: () => {
        throw new Error("ENOENT");
      },
    });
    expect(restored).toBeNull();
  });

  it("returns null on malformed checkpoint JSON", () => {
    const restored = readCompactionCheckpoint("bad", {
      homeDir: "/fake",
      readFile: () => "{not json",
    });
    expect(restored).toBeNull();
  });

  it("checkpointPath joins under the checkpoints dir", () => {
    expect(checkpointPath("abc", "/home")).toMatch(/[\\/]checkpoints[\\/]abc\.json$/);
  });
});
