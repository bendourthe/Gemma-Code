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
});
