import { describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type {
  CodingSessionSummaryT,
  TraceEventT,
} from "../sidecar/src/protocol";
import { SessionCompareView } from "../src/modules/coding/panels/SessionCompareView";

function summary(id: string, title: string): CodingSessionSummaryT {
  return {
    sessionId: id,
    modelId: "gemma4:e4b",
    family: "gemma",
    title,
    createdAt: "2026-05-20T00:00:00.000Z",
    messageCount: 4,
  };
}

function evt(
  id: string,
  offsetMs: number,
  summary: string,
  kind: "tool" | "skill" = "tool",
): TraceEventT {
  const start = Date.parse("2026-05-20T00:00:00.000Z");
  return {
    id,
    timestamp: new Date(start + offsetMs).toISOString(),
    kind,
    summary,
  };
}

function makeManualScheduler(): {
  raf: (cb: FrameRequestCallback) => number;
  caf: (handle: number) => void;
  now: () => number;
  flushAll: (dtMs: number) => void;
} {
  let t = 0;
  const pending: Array<FrameRequestCallback | null> = [];
  return {
    raf: (cb) => {
      pending.push(cb);
      return pending.length;
    },
    caf: (handle) => {
      pending[handle - 1] = null;
    },
    now: () => t,
    flushAll: (dtMs: number) => {
      t += dtMs;
      // Snapshot + clear so re-scheduled callbacks queue up for the next flush.
      const snapshot = pending.slice();
      pending.length = 0;
      for (const cb of snapshot) {
        if (cb) cb(t);
      }
    },
  };
}

describe("SessionCompareView", () => {
  it("renders two scrubbers and an empty diff before any playback", () => {
    render(
      <SessionCompareView
        sessionA={summary("a", "Run A")}
        eventsA={[evt("a1", 0, "tool.pre web_search")]}
        sessionB={summary("b", "Run B")}
        eventsB={[evt("b1", 0, "tool.pre fetch_page")]}
      />,
    );
    expect(screen.getByTestId("session-compare-a")).toBeInTheDocument();
    expect(screen.getByTestId("session-compare-b")).toBeInTheDocument();
    expect(screen.getByTestId("session-compare-diff-empty")).toBeInTheDocument();
  });

  it("populates the diff incrementally as the linked playhead advances", () => {
    const eventsA: TraceEventT[] = [
      evt("a1", 0, "tool.pre web_search"),
      evt("a2", 100, "tool.post web_search"),
      evt("a3", 200, "model.delta"),
    ];
    const eventsB: TraceEventT[] = [
      evt("b1", 0, "tool.pre fetch_page"),
      evt("b2", 100, "tool.post fetch_page"),
      evt("b3", 200, "model.delta"),
    ];
    const scheduler = makeManualScheduler();
    render(
      <SessionCompareView
        sessionA={summary("a", "Run A")}
        eventsA={eventsA}
        sessionB={summary("b", "Run B")}
        eventsB={eventsB}
        now={scheduler.now}
        raf={scheduler.raf}
        caf={scheduler.caf}
      />,
    );
    // Start linked playback via the shared toggle.
    act(() => {
      screen.getByTestId("session-compare-shared-toggle").click();
    });
    // Advance enough to cross all three events.
    for (let i = 0; i < 30; i++) {
      act(() => scheduler.flushAll(20));
    }
    // Three diff rows should exist (one per index).
    const row0 = screen.getByTestId("session-compare-diff-row-0");
    const row1 = screen.getByTestId("session-compare-diff-row-1");
    const row2 = screen.getByTestId("session-compare-diff-row-2");
    expect(row0).toHaveAttribute("data-differs", "true"); // different summaries
    expect(row1).toHaveAttribute("data-differs", "true");
    expect(row2).toHaveAttribute("data-differs", "false"); // same kind+summary
  });

  it("changing the shared speed dropdown propagates to both scrubbers", async () => {
    render(
      <SessionCompareView
        sessionA={summary("a", "A")}
        eventsA={[evt("a1", 0, "x"), evt("a2", 100, "y")]}
        sessionB={summary("b", "B")}
        eventsB={[evt("b1", 0, "u"), evt("b2", 100, "v")]}
      />,
    );
    await userEvent.selectOptions(
      screen.getByTestId("session-compare-shared-speed"),
      "4",
    );
    expect(
      (screen.getByTestId("session-compare-scrubber-a-speed") as HTMLSelectElement)
        .value,
    ).toBe("4");
    expect(
      (screen.getByTestId("session-compare-scrubber-b-speed") as HTMLSelectElement)
        .value,
    ).toBe("4");
  });

  it("renders a close-compare button when onCloseCompare is supplied", async () => {
    let closed = false;
    render(
      <SessionCompareView
        sessionA={summary("a", "A")}
        eventsA={[evt("a1", 0, "x")]}
        sessionB={summary("b", "B")}
        eventsB={[evt("b1", 0, "y")]}
        onCloseCompare={() => {
          closed = true;
        }}
      />,
    );
    await userEvent.click(screen.getByTestId("session-compare-close"));
    expect(closed).toBe(true);
  });
});
