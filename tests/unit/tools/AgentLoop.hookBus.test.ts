import { describe, it, expect, beforeEach } from "vitest";
import { AgentLoop, type PathScopedSkillSource } from "../../../src/tools/AgentLoop.js";
import {
  InProcessHookBus,
  type LifecycleEvent,
} from "../../../core/lifecycle/HookBus.js";
import type { ConversationManager } from "../../../modules/coding/chat/ConversationManager.js";
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
    // v1.4.0 Phase 8 (gap 5.4.P3.T): session.reflection now fires once at the
    // very end, immediately after session.stop. The run is still bracketed by
    // start ... stop; reflection is the trailing session-end signal.
    expect(kinds).toContain("lifecycle.session.stop");
    expect(kinds[kinds.length - 1]).toBe("lifecycle.session.reflection");

    const start = events[0] as Extract<
      LifecycleEvent,
      { kind: "lifecycle.session.start" }
    >;
    expect(start.sessionId).toBe("sess-test-1");
    expect(start.modelId).toBe("gemma3:27b");
    const stop = events.find(
      (e) => e.kind === "lifecycle.session.stop",
    ) as Extract<LifecycleEvent, { kind: "lifecycle.session.stop" }>;
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

describe("AgentLoop -- session.reflection + path-scoped skills (Phase 8)", () => {
  let manager: ConversationManager;
  let registry: ToolRegistry;

  beforeEach(() => {
    manager = makeManager();
    registry = makeRegistry();
  });

  it("emits lifecycle.session.reflection at session end with transcript + filesWritten (gap 5.4.P3.T)", async () => {
    const client = makeClient("Here is my answer.");
    const hookBus = new InProcessHookBus();
    const events: LifecycleEvent[] = [];
    hookBus.onAny((ev) => events.push(ev));

    const loop = new AgentLoop(
      client, manager, registry, "gemma3:27b",
      undefined, undefined, undefined, undefined,
      { sessionId: "sess-reflect", hookBus },
    );
    const { postMessage } = collectMessages();
    await loop.run(postMessage);

    const reflection = events.find((e) => e.kind === "lifecycle.session.reflection") as Extract<
      LifecycleEvent,
      { kind: "lifecycle.session.reflection" }
    >;
    expect(reflection).toBeDefined();
    expect(reflection.sessionId).toBe("sess-reflect");
    expect(typeof reflection.transcript).toBe("string");
    expect(Array.isArray(reflection.filesWritten)).toBe(true);
    expect(reflection.modelId).toBe("gemma3:27b");
    // The reflection fires after the stop event (session-end handler).
    const kinds = events.map((e) => e.kind);
    expect(kinds.lastIndexOf("lifecycle.session.reflection")).toBeGreaterThan(
      kinds.lastIndexOf("lifecycle.session.stop"),
    );
  });

  it("reevaluateSkillsForPath emits skill.entry for newly-active path-scoped skills (gap 5.2.P3.Q)", async () => {
    const client = makeClient("answer");
    const hookBus = new InProcessHookBus();
    const events: LifecycleEvent[] = [];
    hookBus.onAny((ev) => events.push(ev));
    const catalog: PathScopedSkillSource = {
      reevaluatePathScope: (p) =>
        p === "src/api/server.ts"
          ? [{ id: "api-skill", provenance: { source: "user" } }]
          : [],
    };

    const loop = new AgentLoop(
      client, manager, registry, "gemma3:27b",
      undefined, undefined, undefined, undefined,
      { sessionId: "sess-scope", hookBus, skillCatalog: catalog },
    );

    const ids = loop.reevaluateSkillsForPath("src/api/server.ts");
    expect(ids).toEqual(["api-skill"]);
    expect(loop.getActivePathScopedSkillIds()).toEqual(["api-skill"]);

    const entry = events.find((e) => e.kind === "lifecycle.skill.entry") as Extract<
      LifecycleEvent,
      { kind: "lifecycle.skill.entry" }
    >;
    expect(entry).toBeDefined();
    expect(entry.skillId).toBe("api-skill");
    expect(entry.namespace).toBe("user");

    // Switching focus to an out-of-scope path clears the active set; the
    // previously-active skill is not re-emitted on the next match.
    expect(loop.reevaluateSkillsForPath("docs/readme.md")).toEqual([]);
  });

  it("reevaluates path-scoped skills at run start via activeEditPathProvider (gap 5.2.P3.Q)", async () => {
    const client = makeClient("answer");
    const hookBus = new InProcessHookBus();
    const events: LifecycleEvent[] = [];
    hookBus.onAny((ev) => events.push(ev));
    const catalog: PathScopedSkillSource = {
      reevaluatePathScope: () => [{ id: "focus-skill", provenance: { source: "user" } }],
    };

    const loop = new AgentLoop(
      client, manager, registry, "gemma3:27b",
      undefined, undefined, undefined, undefined,
      {
        sessionId: "sess-provider",
        hookBus,
        skillCatalog: catalog,
        activeEditPathProvider: () => "src/index.ts",
      },
    );
    const { postMessage } = collectMessages();
    await loop.run(postMessage);

    expect(loop.getActivePathScopedSkillIds()).toEqual(["focus-skill"]);
    const entry = events.find(
      (e) => e.kind === "lifecycle.skill.entry" && e.skillId === "focus-skill",
    );
    expect(entry).toBeDefined();
  });

  it("reevaluateSkillsForPath is a no-op without a wired catalog", () => {
    const client = makeClient("answer");
    const loop = new AgentLoop(
      client, manager, registry, "gemma3:27b",
      undefined, undefined, undefined, undefined,
      { sessionId: "sess-nocat" },
    );
    expect(loop.reevaluateSkillsForPath("anything")).toEqual([]);
    expect(loop.getActivePathScopedSkillIds()).toEqual([]);
  });
});
