import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryPanel } from "../src/modules/coding/panels/MemoryPanel";
import { TraceDashboardPanel } from "../src/modules/coding/panels/TraceDashboardPanel";
import { SessionListPanel } from "../src/modules/coding/panels/SessionListPanel";
import type {
  CodingSessionSummaryT,
  MemorySnapshotT,
  TraceEventT,
} from "../sidecar/src/protocol";

describe("MemoryPanel", () => {
  it("renders loading state when snapshot is null", () => {
    render(<MemoryPanel snapshot={null} />);
    expect(screen.getByTestId("memory-panel")).toHaveTextContent(/Loading/);
  });

  it("renders all four memory layers + anticipated + proposedSkills", () => {
    const snapshot: MemorySnapshotT = {
      layers: {
        core: ["c1"],
        recent: ["r1"],
        working: ["w1"],
        project: ["p1"],
      },
      anticipated: ["next!"],
      proposedSkills: ["skill-x"],
    };
    render(<MemoryPanel snapshot={snapshot} />);
    expect(screen.getByText("c1")).toBeInTheDocument();
    expect(screen.getByText("r1")).toBeInTheDocument();
    expect(screen.getByText("w1")).toBeInTheDocument();
    expect(screen.getByText("p1")).toBeInTheDocument();
    expect(screen.getByTestId("memory-anticipated")).toHaveTextContent("next!");
    expect(screen.getByTestId("memory-proposed-skills")).toHaveTextContent("skill-x");
  });

  it("renders (empty) for layers with no entries", () => {
    const snapshot: MemorySnapshotT = {
      layers: { core: [], recent: [], working: [], project: [] },
      anticipated: [],
      proposedSkills: [],
    };
    render(<MemoryPanel snapshot={snapshot} />);
    const emptyLabels = screen.getAllByText("(empty)");
    expect(emptyLabels.length).toBeGreaterThanOrEqual(4);
  });

  it("renders a Forget button per row when onForget is supplied (v1.1.0 Phase 6.5)", async () => {
    const snapshot: MemorySnapshotT = {
      layers: { core: ["c1", "c2"], recent: [], working: [], project: [] },
      anticipated: [],
      proposedSkills: [],
    };
    const onForget = vi.fn();
    render(<MemoryPanel snapshot={snapshot} onForget={onForget} />);
    const buttons = screen.getAllByText("Forget");
    expect(buttons.length).toBeGreaterThanOrEqual(2);
    await userEvent.click(buttons[0]!);
    expect(onForget).toHaveBeenCalledWith("core", 0, "c1");
  });

  it("does not render Forget buttons when onForget is omitted", () => {
    const snapshot: MemorySnapshotT = {
      layers: { core: ["c1"], recent: [], working: [], project: [] },
      anticipated: [],
      proposedSkills: [],
    };
    render(<MemoryPanel snapshot={snapshot} />);
    expect(screen.queryByText("Forget")).toBeNull();
  });

  it("shows provenance chips when toggle is on (v1.1.0 Phase 4.5)", async () => {
    const snapshot: MemorySnapshotT = {
      layers: {
        core: ["c1"],
        recent: ["r1"],
        working: [],
        project: [],
      },
      anticipated: [],
      proposedSkills: [],
      provenance: {
        core: [
          {
            hookKind: "lifecycle.tool.post",
            toolName: "write_file",
            sessionId: "sess-1",
          },
        ],
        recent: [null],
      },
    };
    render(<MemoryPanel snapshot={snapshot} />);

    // Chips are hidden by default.
    expect(screen.queryByTestId("memory-provenance-hookKind")).toBeNull();

    await userEvent.click(screen.getByLabelText("Show provenance"));
    expect(screen.getByTestId("memory-provenance-hookKind")).toHaveTextContent(
      "lifecycle.tool.post",
    );
    expect(screen.getByTestId("memory-provenance-toolName")).toHaveTextContent(
      "write_file",
    );
  });
});

describe("TraceDashboardPanel", () => {
  it("renders an empty-state when no events present", () => {
    render(<TraceDashboardPanel events={[]} />);
    expect(screen.getByTestId("trace-panel")).toHaveTextContent(/No trace events/);
  });

  it("renders each event by id", () => {
    const events: TraceEventT[] = [
      { id: "a", timestamp: "2026-05-17T11:00:00Z", kind: "tool", summary: "read_file" },
      { id: "b", timestamp: "2026-05-17T11:00:01Z", kind: "skill", summary: "load skill" },
    ];
    render(<TraceDashboardPanel events={events} />);
    expect(screen.getByTestId("trace-event-a")).toHaveTextContent("read_file");
    expect(screen.getByTestId("trace-event-b")).toHaveTextContent("load skill");
  });

  it("derives the routing lane from a replayed fixture payload (v2.1.0 Phase 2)", () => {
    const events: TraceEventT[] = [
      {
        id: "t-003",
        timestamp: "2026-05-17T11:30:08.000Z",
        kind: "scheduler",
        summary: "routing.decision escalate lightning -> muse",
        payload: {
          kind: "routing.decision",
          turn: 4,
          role: "worker",
          modelId: "muse-glimmer:30b",
          previousModelId: "nemotron-lightning:30b-a3b",
          action: "escalate",
          reason: "tool-error-streak",
        },
      },
    ];
    render(<TraceDashboardPanel events={events} />);
    expect(screen.getByTestId("trace-routing-model-4")).toHaveTextContent(
      "muse-glimmer:30b",
    );
    expect(screen.getByTestId("trace-routing-escalation-4")).toBeInTheDocument();
  });

  it("filters events by hookKind via the dropdown (v1.1.0 Phase 4.5)", async () => {
    const events: TraceEventT[] = [
      {
        id: "a",
        timestamp: "2026-05-17T11:00:00Z",
        kind: "tool",
        summary: "pre",
        hookKind: "lifecycle.tool.pre",
      },
      {
        id: "b",
        timestamp: "2026-05-17T11:00:01Z",
        kind: "tool",
        summary: "post",
        hookKind: "lifecycle.tool.post",
      },
      {
        id: "c",
        timestamp: "2026-05-17T11:00:02Z",
        kind: "skill",
        summary: "no-hookkind event",
      },
    ];
    render(<TraceDashboardPanel events={events} />);

    expect(screen.getByTestId("trace-event-a")).toBeInTheDocument();
    expect(screen.getByTestId("trace-event-b")).toBeInTheDocument();

    const select = screen.getByLabelText("Filter by hookKind");
    await userEvent.selectOptions(select, "lifecycle.tool.pre");

    expect(screen.getByTestId("trace-event-a")).toBeInTheDocument();
    expect(screen.queryByTestId("trace-event-b")).not.toBeInTheDocument();
    // Events without a hookKind are always visible.
    expect(screen.getByTestId("trace-event-c")).toBeInTheDocument();
  });

  it("renders a left-side session list when sessions are supplied (v1.1.0 Phase 7.1)", async () => {
    const sessions: CodingSessionSummaryT[] = [
      {
        sessionId: "abcdef1234",
        modelId: "gemma4:e4b",
        family: "gemma",
        title: "Run alpha",
        createdAt: "2026-05-20T11:00:00.000Z",
        messageCount: 3,
      },
      {
        sessionId: "deadbeef99",
        modelId: "qwen2.5-coder:7b",
        family: "qwen",
        title: "Run beta",
        createdAt: "2026-05-20T12:00:00.000Z",
        messageCount: 7,
      },
    ];
    const onSelect = vi.fn();
    render(
      <TraceDashboardPanel
        events={[]}
        sessions={sessions}
        activeSessionId="abcdef1234"
        onSelectSession={onSelect}
      />,
    );
    expect(screen.getByTestId("trace-session-list")).toBeInTheDocument();
    expect(screen.getByTestId("trace-session-abcdef1234")).toBeInTheDocument();
    expect(screen.getByTestId("trace-session-deadbeef99")).toBeInTheDocument();
    expect(
      screen.getByTestId("trace-active-session-title"),
    ).toHaveTextContent("Run alpha");
    await userEvent.click(screen.getByTestId("trace-session-deadbeef99"));
    expect(onSelect).toHaveBeenCalledWith("deadbeef99");
  });

  it("opens compare picker and forwards pick to onPickCompareSession (Phase 7.3)", async () => {
    const sessions: CodingSessionSummaryT[] = [
      {
        sessionId: "s1",
        modelId: "m",
        family: "gemma",
        title: "A",
        createdAt: "2026-05-20T11:00:00.000Z",
        messageCount: 2,
      },
      {
        sessionId: "s2",
        modelId: "m",
        family: "gemma",
        title: "B",
        createdAt: "2026-05-20T12:00:00.000Z",
        messageCount: 2,
      },
    ];
    const onPick = vi.fn();
    render(
      <TraceDashboardPanel
        events={[]}
        sessions={sessions}
        activeSessionId="s1"
        onPickCompareSession={onPick}
      />,
    );
    await userEvent.click(screen.getByTestId("trace-compare-open"));
    expect(screen.getByTestId("trace-compare-picker")).toBeInTheDocument();
    // s1 is excluded from the picker (it's the active session).
    expect(screen.queryByTestId("trace-compare-pick-s1")).toBeNull();
    await userEvent.click(screen.getByTestId("trace-compare-pick-s2"));
    expect(onPick).toHaveBeenCalledWith("s2");
  });

  it("renders the SessionCompareView when compareSession + compareEvents are supplied", () => {
    const sessions: CodingSessionSummaryT[] = [
      {
        sessionId: "s1",
        modelId: "m",
        family: "gemma",
        title: "A",
        createdAt: "2026-05-20T11:00:00.000Z",
        messageCount: 2,
      },
      {
        sessionId: "s2",
        modelId: "m",
        family: "gemma",
        title: "B",
        createdAt: "2026-05-20T12:00:00.000Z",
        messageCount: 2,
      },
    ];
    const events: TraceEventT[] = [
      { id: "a1", timestamp: "2026-05-20T11:00:00.000Z", kind: "tool", summary: "x" },
    ];
    const compareEvents: TraceEventT[] = [
      { id: "b1", timestamp: "2026-05-20T12:00:00.000Z", kind: "tool", summary: "y" },
    ];
    render(
      <TraceDashboardPanel
        events={events}
        sessions={sessions}
        activeSessionId="s1"
        compareSession={sessions[1]!}
        compareEvents={compareEvents}
      />,
    );
    expect(screen.getByTestId("session-compare")).toBeInTheDocument();
  });
});

describe("SessionListPanel", () => {
  const sessions: CodingSessionSummaryT[] = [
    {
      sessionId: "s1",
      modelId: "gemma4:e4b",
      family: "gemma",
      title: "Refactor",
      createdAt: "2026-05-17T11:00:00Z",
      messageCount: 3,
    },
    {
      sessionId: "s2",
      modelId: "qwen2.5-coder:7b",
      family: "qwen",
      title: "Debug",
      createdAt: "2026-05-17T12:00:00Z",
      messageCount: 1,
    },
  ];

  it("renders the empty state when there are no sessions", () => {
    render(<SessionListPanel sessions={[]} activeSessionId={null} onResume={() => {}} />);
    expect(screen.getByTestId("sessions-panel")).toHaveTextContent(/No previous/);
  });

  it("invokes onResume with the picked sessionId", async () => {
    const onResume = vi.fn();
    render(
      <SessionListPanel sessions={sessions} activeSessionId={null} onResume={onResume} />,
    );
    await userEvent.click(screen.getByTestId("session-s1"));
    expect(onResume).toHaveBeenCalledWith("s1");
  });

  it("highlights the active session", () => {
    render(
      <SessionListPanel sessions={sessions} activeSessionId="s2" onResume={() => {}} />,
    );
    const row = screen.getByTestId("session-s2");
    expect(row).toBeInTheDocument();
  });

  it("renames and deletes a session from the list", async () => {
    const onRename = vi.fn();
    const onDelete = vi.fn();
    render(
      <SessionListPanel
        sessions={sessions}
        activeSessionId={null}
        onResume={() => {}}
        onRename={onRename}
        onDelete={onDelete}
      />,
    );
    await userEvent.click(screen.getByTestId("session-rename-s1"));
    const input = screen.getByTestId("session-rename-input-s1");
    await userEvent.clear(input);
    await userEvent.type(input, "Fresh title{Enter}");
    expect(onRename).toHaveBeenCalledWith("s1", "Fresh title");
    await userEvent.click(screen.getByTestId("session-delete-s1"));
    await userEvent.click(screen.getByTestId("session-delete-confirm-s1"));
    expect(onDelete).toHaveBeenCalledWith("s1");
  });
});
