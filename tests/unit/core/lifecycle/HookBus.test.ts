import { describe, it, expect } from "vitest";
import {
  InProcessHookBus,
  type LifecycleEvent,
  type LifecycleEventKind,
} from "../../../../core/lifecycle/HookBus.js";
import {
  InProcessTelemetryBus,
  type TelemetryEvent,
} from "../../../../core/telemetry/TelemetryBus.js";

/**
 * v1.1.0 Phase 4.2 -- typed lifecycle bus tests.
 *
 * Covers:
 *   * Every event kind round-trips through emit / on with the correct
 *     typed payload.
 *   * The `onAny` subscription receives the full event stream.
 *   * Every emit republishes onto the underlying `TelemetryBus` so
 *     trace-side consumers see the lifecycle stream.
 *   * `Disposable.dispose()` actually unsubscribes.
 *   * A misbehaving subscriber does not take the bus down.
 */

const ALL_EVENTS: ReadonlyArray<LifecycleEvent> = [
  {
    kind: "lifecycle.session.start",
    sessionId: "sess-1",
    modelId: "gemma3:27b",
    isoTime: "2026-05-19T10:00:00.000Z",
  },
  {
    kind: "lifecycle.session.stop",
    sessionId: "sess-1",
    isoTime: "2026-05-19T10:01:00.000Z",
    durationMs: 60_000,
  },
  { kind: "lifecycle.session.end", sessionId: "sess-1", summary: "done" },
  {
    kind: "lifecycle.user.prompt",
    sessionId: "sess-1",
    message: "hi",
    isoTime: "2026-05-19T10:00:30.000Z",
  },
  {
    kind: "lifecycle.tool.pre",
    sessionId: "sess-1",
    toolName: "write_file",
    args: { path: "/tmp/x" },
    parentSpanId: "span-1",
  },
  {
    kind: "lifecycle.tool.post",
    sessionId: "sess-1",
    toolName: "write_file",
    ok: true,
    durationMs: 12,
    parentSpanId: "span-1",
  },
  {
    kind: "lifecycle.tool.failed",
    sessionId: "sess-1",
    toolName: "run_terminal",
    redactedError: "ENOENT",
    parentSpanId: "span-2",
  },
  {
    kind: "lifecycle.subagent.start",
    sessionId: "sess-1",
    role: "verification",
    parentSpanId: "span-3",
  },
  {
    kind: "lifecycle.subagent.stop",
    sessionId: "sess-1",
    role: "verification",
    ok: true,
    parentSpanId: "span-3",
  },
  {
    kind: "lifecycle.context.preCompact",
    sessionId: "sess-1",
    beforeTokens: 8192,
    afterTokens: 4096,
  },
  {
    kind: "lifecycle.notification",
    notificationKind: "info",
    message: "test",
    severity: "info",
  },
  {
    kind: "lifecycle.skill.entry",
    sessionId: "sess-1",
    skillId: "claude-api",
    namespace: "ai-development",
    parentSpanId: "span-4",
  },
];

describe("InProcessHookBus", () => {
  it("delivers each event kind to its typed subscriber", () => {
    const bus = new InProcessHookBus();
    const received: Record<string, LifecycleEvent | null> = {};
    for (const ev of ALL_EVENTS) {
      received[ev.kind] = null;
      bus.on(ev.kind, (payload) => {
        received[ev.kind] = payload as LifecycleEvent;
      });
    }
    for (const ev of ALL_EVENTS) {
      bus.emit(ev);
    }
    for (const ev of ALL_EVENTS) {
      expect(received[ev.kind]).toEqual(ev);
    }
  });

  it("onAny receives every event regardless of kind", () => {
    const bus = new InProcessHookBus();
    const sink: LifecycleEvent[] = [];
    bus.onAny((ev) => sink.push(ev));
    for (const ev of ALL_EVENTS) {
      bus.emit(ev);
    }
    expect(sink.length).toBe(ALL_EVENTS.length);
    expect(new Set(sink.map((e) => e.kind))).toEqual(
      new Set(ALL_EVENTS.map((e) => e.kind)),
    );
  });

  it("republishes every emit onto the underlying TelemetryBus", () => {
    const telemetry = new InProcessTelemetryBus();
    const bus = new InProcessHookBus(telemetry, "test");
    const seen: TelemetryEvent[] = [];
    telemetry.subscribe({}, (ev) => seen.push(ev));
    for (const ev of ALL_EVENTS) {
      bus.emit(ev);
    }
    expect(seen.length).toBe(ALL_EVENTS.length);
    expect(seen.every((s) => s.source === "test")).toBe(true);
    const kinds = new Set(seen.map((s) => s.kind as LifecycleEventKind));
    expect(kinds).toEqual(new Set(ALL_EVENTS.map((e) => e.kind)));
  });

  it("Disposable.dispose() unsubscribes the handler", () => {
    const bus = new InProcessHookBus();
    let count = 0;
    const disposable = bus.on("lifecycle.session.start", () => {
      count += 1;
    });
    bus.emit({
      kind: "lifecycle.session.start",
      sessionId: "s",
      modelId: "m",
      isoTime: "2026-05-19T00:00:00.000Z",
    });
    disposable.dispose();
    bus.emit({
      kind: "lifecycle.session.start",
      sessionId: "s",
      modelId: "m",
      isoTime: "2026-05-19T00:00:01.000Z",
    });
    expect(count).toBe(1);
  });

  it("a throwing subscriber does not interrupt the others", () => {
    const bus = new InProcessHookBus();
    let calledSecond = 0;
    bus.on("lifecycle.notification", () => {
      throw new Error("boom");
    });
    bus.on("lifecycle.notification", () => {
      calledSecond += 1;
    });
    expect(() => {
      bus.emit({
        kind: "lifecycle.notification",
        notificationKind: "info",
        message: "x",
        severity: "info",
      });
    }).not.toThrow();
    expect(calledSecond).toBe(1);
  });
});
