import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LocalModelStatus } from "../src/components/LocalModelStatus";
import { createMockTelemetryStream } from "../src/lib/telemetryMock";
import type {
  LocalModelTelemetry,
  TelemetryStream,
  TelemetrySubscriber,
} from "../src/components/LocalModelStatus.types";

function manualStream(): TelemetryStream & {
  push(sample: LocalModelTelemetry): void;
  subscribers: Set<TelemetrySubscriber>;
} {
  const subscribers = new Set<TelemetrySubscriber>();
  return {
    subscribers,
    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
    push(sample) {
      for (const fn of subscribers) fn(sample);
    },
  };
}

describe("LocalModelStatus", () => {
  it("renders the muted state when stream is null", () => {
    render(<LocalModelStatus stream={null} />);
    const node = screen.getByTestId("local-model-status");
    expect(node.dataset.state).toBe("muted");
    expect(node).toHaveTextContent(/telemetry unavailable/i);
  });

  it("renders loading state before the first sample arrives", () => {
    const stream = manualStream();
    render(<LocalModelStatus stream={stream} />);
    const node = screen.getByTestId("local-model-status");
    expect(node.dataset.state).toBe("loading");
  });

  it("renders an active sample and updates on subsequent ticks", () => {
    const stream = manualStream();
    render(<LocalModelStatus stream={stream} />);
    act(() => {
      stream.push({
        modelName: "Gemma 4",
        paramSize: "7B",
        gpuPct: 42,
        vramFreeGB: 4.5,
        deviceName: "RTX 3080",
        lastUpdated: 1,
      });
    });
    expect(screen.getByText(/Gemma 4 7B/)).toBeInTheDocument();
    expect(screen.getByText(/GPU: 42%/)).toBeInTheDocument();
    expect(screen.getByText(/4\.5 GB free/)).toBeInTheDocument();

    act(() => {
      stream.push({
        modelName: "Gemma 4",
        paramSize: "7B",
        gpuPct: 90,
        vramFreeGB: 1.2,
        deviceName: "RTX 3080",
        lastUpdated: 2,
      });
    });
    expect(screen.getByText(/GPU: 90%/)).toBeInTheDocument();
  });

  it("clamps and color-codes GPU percentage", () => {
    const stream = manualStream();
    const { rerender } = render(<LocalModelStatus stream={stream} />);
    act(() =>
      stream.push({
        modelName: "X",
        paramSize: "1B",
        gpuPct: 200,
        vramFreeGB: 0.5,
        deviceName: "GPU",
        lastUpdated: 1,
      }),
    );
    const bar = screen.getByTestId("gpu-bar");
    expect(bar.style.width).toBe("100%");

    rerender(<LocalModelStatus stream={stream} />);
    act(() =>
      stream.push({
        modelName: "X",
        paramSize: "1B",
        gpuPct: -5,
        vramFreeGB: 8,
        deviceName: "GPU",
        lastUpdated: 2,
      }),
    );
    expect(screen.getByTestId("gpu-bar").style.width).toBe("0%");
  });

  it("createMockTelemetryStream emits ticks on the interval", () => {
    vi.useFakeTimers();
    const stream = createMockTelemetryStream({ intervalMs: 50, now: () => 1000 });
    const samples: LocalModelTelemetry[] = [];
    const unsub = stream.subscribe((s) => samples.push(s));
    expect(samples.length).toBe(1); // emits immediately on subscribe
    vi.advanceTimersByTime(120);
    expect(samples.length).toBeGreaterThanOrEqual(3);
    unsub();
    stream.stop();
  });

  it("createMockTelemetryStream stops cleanly when the last subscriber leaves", () => {
    vi.useFakeTimers();
    const stream = createMockTelemetryStream({ intervalMs: 30 });
    const samples: LocalModelTelemetry[] = [];
    const unsub = stream.subscribe((s) => samples.push(s));
    vi.advanceTimersByTime(60);
    unsub();
    const before = samples.length;
    vi.advanceTimersByTime(120);
    expect(samples.length).toBe(before);
  });
});
