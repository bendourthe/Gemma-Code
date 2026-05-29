import { describe, it, expect } from "vitest";
import {
  InProcessHookBus,
  type LifecycleSessionReflectionEvent,
} from "../../../../core/lifecycle/HookBus.js";
import {
  attachSessionReflectionHook,
  buildReflectionArtifact,
  renderReflectionMarkdown,
  DEFAULT_REFLECTION_PATTERNS,
} from "../../../../core/lifecycle/SessionReflectionHook.js";

function fakeEvent(
  overrides: Partial<LifecycleSessionReflectionEvent> = {},
): LifecycleSessionReflectionEvent {
  return {
    kind: "lifecycle.session.reflection",
    sessionId: "test-session-123",
    isoTime: "2026-05-28T18:00:00.000Z",
    transcript: "agent: ran the test\n\nuser: yes exactly, perfect\n\nagent: continued",
    filesWritten: ["src/foo.ts", "tests/foo.test.ts"],
    ...overrides,
  };
}

describe("Phase 5.4 -- session-reflection hook", () => {
  it("emits the new lifecycle.session.reflection event through the bus", () => {
    const bus = new InProcessHookBus(null);
    const received: LifecycleSessionReflectionEvent[] = [];
    bus.on("lifecycle.session.reflection", (e) => received.push(e));
    bus.emit(fakeEvent());
    expect(received).toHaveLength(1);
    expect(received[0]?.sessionId).toBe("test-session-123");
    expect(received[0]?.filesWritten).toEqual(["src/foo.ts", "tests/foo.test.ts"]);
  });

  it("does not invoke handlers subscribed to other event kinds", () => {
    const bus = new InProcessHookBus(null);
    let called = 0;
    bus.on("lifecycle.session.end", () => (called += 1));
    bus.emit(fakeEvent());
    expect(called).toBe(0);
  });

  it("buildReflectionArtifact mines 'user said X, I did Y wrong' patterns", () => {
    const artifact = buildReflectionArtifact(
      fakeEvent({
        transcript:
          "user: no, don't do that, you're wrong\n\nagent: apologies\n\nuser: yes exactly, perfect",
      }),
    );
    const ids = artifact.findings.map((f) => f.patternId).sort();
    // Both 'user-corrected' and 'user-confirmed' should match against
    // their respective paragraphs.
    expect(ids).toContain("user-corrected");
    expect(ids).toContain("user-confirmed");
  });

  it("buildReflectionArtifact returns an empty findings array on a clean transcript", () => {
    const artifact = buildReflectionArtifact(
      fakeEvent({ transcript: "agent: noted\n\nuser: ok thanks" }),
    );
    expect(artifact.findings).toEqual([]);
  });

  it("renderReflectionMarkdown produces the expected document structure", () => {
    const artifact = buildReflectionArtifact(fakeEvent());
    const md = renderReflectionMarkdown(artifact);
    expect(md).toContain("# Session reflection -- test-session-123");
    expect(md).toContain("**Generated**: 2026-05-28T18:00:00.000Z");
    expect(md).toContain("## Files written");
    expect(md).toContain("src/foo.ts");
    expect(md).toContain("## Reflection findings");
  });

  it("attachSessionReflectionHook writes the artifact to <home>/reflections/<sid>.md", () => {
    const bus = new InProcessHookBus(null);
    const writes: Array<{ path: string; content: string }> = [];
    const dirs: string[] = [];
    const disposable = attachSessionReflectionHook(bus, {
      homeDir: "/fake/nexus-home",
      writeFile: (p, c) => writes.push({ path: p, content: c }),
      mkdir: (d) => dirs.push(d),
    });

    bus.emit(fakeEvent());
    expect(dirs).toEqual([
      // path.join on win32 produces backslashes; on POSIX, forward slashes.
      expect.stringMatching(/[\\/]reflections$/),
    ]);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.path).toMatch(/test-session-123\.md$/);
    expect(writes[0]?.content).toContain("# Session reflection -- test-session-123");

    disposable.dispose();
    bus.emit(fakeEvent({ sessionId: "should-not-fire" }));
    expect(writes).toHaveLength(1);
  });

  it("attachSessionReflectionHook never throws even when writeFile fails", () => {
    const bus = new InProcessHookBus(null);
    attachSessionReflectionHook(bus, {
      homeDir: "/fake",
      writeFile: () => {
        throw new Error("disk full");
      },
      mkdir: () => {
        /* no-op */
      },
    });
    expect(() => bus.emit(fakeEvent())).not.toThrow();
  });

  it("respects custom pattern sets", () => {
    const bus = new InProcessHookBus(null);
    const writes: Array<{ path: string; content: string }> = [];
    attachSessionReflectionHook(bus, {
      homeDir: "/fake",
      patterns: [
        {
          id: "always",
          description: "matches every chunk",
          pattern: /[\s\S]+/,
        },
      ],
      writeFile: (p, c) => writes.push({ path: p, content: c }),
      mkdir: () => {
        /* no-op */
      },
    });
    bus.emit(fakeEvent({ transcript: "first\n\nsecond" }));
    expect(writes[0]?.content).toContain("always -- matches every chunk");
  });

  it("DEFAULT_REFLECTION_PATTERNS includes at least the three documented patterns", () => {
    const ids = DEFAULT_REFLECTION_PATTERNS.map((p) => p.id);
    expect(ids).toContain("user-corrected");
    expect(ids).toContain("user-confirmed");
    expect(ids).toContain("user-said-i-did-wrong");
  });
});
