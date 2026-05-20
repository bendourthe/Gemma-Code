import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { TraceEventT } from "../sidecar/src/protocol";
import { TimelineScrubber } from "../src/modules/coding/panels/TimelineScrubber";

function synthSession(count: number, stepMs: number): TraceEventT[] {
  const start = Date.parse("2026-05-20T00:00:00.000Z");
  return Array.from({ length: count }, (_, i) => ({
    id: `e${i}`,
    timestamp: new Date(start + i * stepMs).toISOString(),
    kind: i % 2 === 0 ? "tool" : "skill",
    summary: `event-${i}`,
  }));
}

/**
 * Build a tiny manual scheduler that lets the test step time deterministically.
 * Each call to `flush(dtMs)` advances the clock by `dtMs` then invokes the
 * currently-pending rAF callback (if any).
 */
function makeManualScheduler(): {
  raf: (cb: FrameRequestCallback) => number;
  caf: (handle: number) => void;
  now: () => number;
  flush: (dtMs: number) => void;
} {
  let t = 0;
  let pending: FrameRequestCallback | null = null;
  let handle = 0;
  return {
    raf: (cb) => {
      pending = cb;
      handle += 1;
      return handle;
    },
    caf: () => {
      pending = null;
    },
    now: () => t,
    flush: (dtMs: number) => {
      t += dtMs;
      const cb = pending;
      pending = null;
      if (cb) cb(t);
    },
  };
}

describe("TimelineScrubber", () => {
  it("renders empty state when no events", () => {
    render(<TimelineScrubber events={[]} />);
    expect(screen.getByTestId("timeline-scrubber")).toBeInTheDocument();
    expect(screen.getByTestId("timeline-scrubber-toggle")).toBeDisabled();
  });

  it("renders a tick mark for every event", () => {
    const events = synthSession(4, 1000);
    render(<TimelineScrubber events={events} />);
    for (const e of events) {
      expect(
        screen.getByTestId(`timeline-scrubber-tick-${e.id}`),
      ).toBeInTheDocument();
    }
  });

  it("toggles play/pause via the Play button", async () => {
    const events = synthSession(3, 1000);
    const scheduler = makeManualScheduler();
    render(
      <TimelineScrubber
        events={events}
        now={scheduler.now}
        raf={scheduler.raf}
        caf={scheduler.caf}
      />,
    );
    const btn = screen.getByTestId("timeline-scrubber-toggle");
    expect(btn).toHaveTextContent("Play");
    await userEvent.click(btn);
    expect(btn).toHaveTextContent("Pause");
    await userEvent.click(btn);
    expect(btn).toHaveTextContent("Play");
  });

  it("plays a synthetic 10-event session at 2x in ~50% of wall-clock time", async () => {
    // Wall clock: 10 events spaced 100ms apart -> total duration 900ms.
    // At 2x speed we expect playback to complete after dt summed to >= 450ms.
    const events = synthSession(10, 100);
    const totalDurationMs = 900;
    const scheduler = makeManualScheduler();
    const onCross = vi.fn();
    render(
      <TimelineScrubber
        events={events}
        onPlayheadCross={onCross}
        now={scheduler.now}
        raf={scheduler.raf}
        caf={scheduler.caf}
      />,
    );
    // Switch to 2x.
    await userEvent.selectOptions(
      screen.getByTestId("timeline-scrubber-speed"),
      "2",
    );
    // Start playback.
    await userEvent.click(screen.getByTestId("timeline-scrubber-toggle"));

    // Step 16ms frames until the scrubber actually finishes (toggle resets
    // to "Play"). We can't gate on the formatted playhead text since
    // toFixed(2) collapses 0.896s and 0.900s into the same "0.90s" string.
    let elapsed = 0;
    const stepMs = 16;
    const maxLoops = 200;
    let loops = 0;
    while (loops < maxLoops) {
      act(() => scheduler.flush(stepMs));
      elapsed += stepMs;
      const toggleText = screen
        .getByTestId("timeline-scrubber-toggle")
        .textContent;
      if (toggleText === "Play") break;
      loops += 1;
    }
    // 2x speed -> wall-clock elapsed should be roughly half of 900ms.
    expect(elapsed).toBeLessThanOrEqual(totalDurationMs * 0.6);
    expect(elapsed).toBeGreaterThanOrEqual(totalDurationMs * 0.4);
    // All 10 events should have been crossed exactly once.
    const allCrossed = onCross.mock.calls.flatMap((c) => c[0] as TraceEventT[]);
    expect(allCrossed.map((e) => e.id)).toEqual(events.map((e) => e.id));
    // Playback ends with the toggle back to "Play".
    expect(screen.getByTestId("timeline-scrubber-toggle")).toHaveTextContent(
      "Play",
    );
  });

  it("seek via slider updates the playhead and re-fires events from that point", async () => {
    const events = synthSession(4, 1000);
    const onCross = vi.fn();
    const scheduler = makeManualScheduler();
    render(
      <TimelineScrubber
        events={events}
        onPlayheadCross={onCross}
        now={scheduler.now}
        raf={scheduler.raf}
        caf={scheduler.caf}
      />,
    );
    // Seek to 2.5s -- between e2 (2.0s) and e3 (3.0s).
    const slider = screen.getByTestId("timeline-scrubber-slider") as HTMLInputElement;
    fireEvent.change(slider, { target: { value: "2500" } });
    expect(
      screen.getByTestId("timeline-scrubber-playhead").textContent,
    ).toMatch(/2\.50s/);
    // Play to the end -- only e3 should fire after the seek.
    onCross.mockClear();
    await userEvent.click(screen.getByTestId("timeline-scrubber-toggle"));
    for (let i = 0; i < 100; i++) {
      act(() => scheduler.flush(50));
      if (
        screen
          .getByTestId("timeline-scrubber-playhead")
          .textContent?.startsWith("3.00s")
      ) {
        break;
      }
    }
    const crossedIds = onCross.mock.calls
      .flatMap((c) => c[0] as TraceEventT[])
      .map((e) => e.id);
    expect(crossedIds).toEqual(["e3"]);
  });

  it("Go-to-start and Go-to-end buttons jump the playhead", async () => {
    const events = synthSession(3, 1000);
    render(<TimelineScrubber events={events} />);
    await userEvent.click(screen.getByTestId("timeline-scrubber-go-end"));
    expect(
      screen.getByTestId("timeline-scrubber-playhead").textContent,
    ).toMatch(/2\.00s/);
    await userEvent.click(screen.getByTestId("timeline-scrubber-go-start"));
    expect(
      screen.getByTestId("timeline-scrubber-playhead").textContent,
    ).toMatch(/0\.00s/);
  });

  it("changing the speed dropdown updates internal speed", async () => {
    const events = synthSession(2, 1000);
    render(<TimelineScrubber events={events} />);
    const sel = screen.getByTestId("timeline-scrubber-speed") as HTMLSelectElement;
    await userEvent.selectOptions(sel, "4");
    expect(sel.value).toBe("4");
  });

  it("controlled mode bubbles play and speed changes via callbacks", async () => {
    const onPlaying = vi.fn();
    const onSpeed = vi.fn();
    const events = synthSession(2, 1000);
    render(
      <TimelineScrubber
        events={events}
        playing={false}
        speed={1}
        onPlayingChange={onPlaying}
        onSpeedChange={onSpeed}
      />,
    );
    await userEvent.click(screen.getByTestId("timeline-scrubber-toggle"));
    expect(onPlaying).toHaveBeenCalledWith(true);
    await userEvent.selectOptions(
      screen.getByTestId("timeline-scrubber-speed"),
      "2",
    );
    expect(onSpeed).toHaveBeenCalledWith(2);
  });

  it("re-seeks to 0 when the events list changes", () => {
    const a = synthSession(2, 1000);
    const b = synthSession(3, 500);
    const { rerender } = render(<TimelineScrubber events={a} />);
    rerender(<TimelineScrubber events={b} />);
    expect(
      screen.getByTestId("timeline-scrubber-playhead").textContent,
    ).toMatch(/0\.00s/);
  });
});
