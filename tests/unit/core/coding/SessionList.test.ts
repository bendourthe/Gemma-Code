import { describe, it, expect } from "vitest";
import {
  ACTIVE_SESSION_SETTING_KEY,
  applySubAgentEvent,
  applySubAgentEvents,
  emptySubAgentTimeline,
  projectSessionListView,
  resolveActiveSessionId,
  type SessionSummaryInput,
  type SubAgentEvent,
} from "../../../../core/coding/SessionList.js";

const SESSIONS: readonly SessionSummaryInput[] = Object.freeze([
  {
    sessionId: "s-newest",
    modelId: "gemma4:e4b",
    title: "Latest chat",
    createdAt: "2026-05-20T12:00:00Z",
    messageCount: 4,
  },
  {
    sessionId: "s-old",
    modelId: "qwen2.5-coder:7b",
    title: "Older chat",
    createdAt: "2026-05-19T08:00:00Z",
    messageCount: 12,
  },
]);

describe("projectSessionListView", () => {
  it("returns an empty view when no sessions exist", () => {
    const view = projectSessionListView([], null);
    expect(view.rows).toEqual([]);
    expect(view.activeSessionId).toBeNull();
  });

  it("tags the active session as isActive=true", () => {
    const view = projectSessionListView(SESSIONS, "s-old");
    expect(view.rows[0]?.isActive).toBe(false);
    expect(view.rows[1]?.isActive).toBe(true);
    expect(view.activeSessionId).toBe("s-old");
  });

  it("returns activeSessionId=null when the supplied id does not match any session", () => {
    const view = projectSessionListView(SESSIONS, "ghost");
    expect(view.activeSessionId).toBeNull();
    for (const r of view.rows) expect(r.isActive).toBe(false);
  });
});

describe("resolveActiveSessionId", () => {
  it("returns the stored id when it matches a known session", () => {
    expect(resolveActiveSessionId("s-old", SESSIONS)).toBe("s-old");
  });

  it("falls back to the newest session when the stored id is missing", () => {
    expect(resolveActiveSessionId(null, SESSIONS)).toBe("s-newest");
  });

  it("falls back to the newest session when the stored id is stale", () => {
    expect(resolveActiveSessionId("retired", SESSIONS)).toBe("s-newest");
  });

  it("returns null when there are no sessions at all", () => {
    expect(resolveActiveSessionId("any", [])).toBeNull();
  });

  it("exposes the canonical settings key", () => {
    expect(ACTIVE_SESSION_SETTING_KEY).toBe("nexus.coding.activeSessionId");
  });
});

describe("applySubAgentEvent / applySubAgentEvents", () => {
  it("creates a running row on subagent.start", () => {
    let s = emptySubAgentTimeline();
    s = applySubAgentEvent(s, {
      kind: "subagent.start",
      spawnId: "spawn-1",
      agentType: "researcher",
      task: "investigate flaky test",
      startedAt: "2026-05-20T12:00:00Z",
    });
    expect(s.rows).toHaveLength(1);
    expect(s.rows[0]?.status).toBe("running");
    expect(s.rows[0]?.stoppedAt).toBeNull();
  });

  it("is idempotent: replaying the same subagent.start does not duplicate", () => {
    const start: SubAgentEvent = {
      kind: "subagent.start",
      spawnId: "spawn-1",
      agentType: "researcher",
      task: "x",
      startedAt: "2026-05-20T12:00:00Z",
    };
    let s = emptySubAgentTimeline();
    s = applySubAgentEvent(s, start);
    s = applySubAgentEvent(s, start);
    expect(s.rows).toHaveLength(1);
  });

  it("updates the matching row on subagent.stop", () => {
    const events: readonly SubAgentEvent[] = [
      {
        kind: "subagent.start",
        spawnId: "spawn-1",
        agentType: "researcher",
        task: "x",
        startedAt: "2026-05-20T12:00:00Z",
      },
      {
        kind: "subagent.stop",
        spawnId: "spawn-1",
        stoppedAt: "2026-05-20T12:05:00Z",
        status: "completed",
        summary: "found root cause",
      },
    ];
    const s = applySubAgentEvents(events);
    expect(s.rows[0]?.status).toBe("completed");
    expect(s.rows[0]?.stoppedAt).toBe("2026-05-20T12:05:00Z");
    expect(s.rows[0]?.summary).toBe("found root cause");
  });

  it("handles multiple concurrent sub-agent spawns", () => {
    const events: readonly SubAgentEvent[] = [
      {
        kind: "subagent.start",
        spawnId: "s1",
        agentType: "researcher",
        task: "a",
        startedAt: "t1",
      },
      {
        kind: "subagent.start",
        spawnId: "s2",
        agentType: "coder",
        task: "b",
        startedAt: "t2",
      },
      {
        kind: "subagent.stop",
        spawnId: "s1",
        stoppedAt: "t3",
        status: "completed",
      },
    ];
    const s = applySubAgentEvents(events);
    expect(s.rows).toHaveLength(2);
    expect(s.rows[0]?.status).toBe("completed");
    expect(s.rows[1]?.status).toBe("running");
  });

  it("freezes the rows array", () => {
    const s = applySubAgentEvents([
      {
        kind: "subagent.start",
        spawnId: "s",
        agentType: "t",
        task: "x",
        startedAt: "t1",
      },
    ]);
    expect(Object.isFrozen(s.rows)).toBe(true);
  });
});
