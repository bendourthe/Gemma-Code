import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TraceEventT } from "../../../../sidecar/src/protocol";

export const PLAYBACK_SPEEDS = [0.5, 1, 2, 4] as const;
export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];

export interface TimelineScrubberProps {
  events: readonly TraceEventT[];
  /**
   * Optional external play/pause control. When provided, the parent owns the
   * playing state -- this is how Phase 7.3 "compare two sessions" links a
   * single Play/Pause toggle across the two scrubbers.
   */
  playing?: boolean;
  /** Optional speed override -- enables the shared speed dropdown in compare mode. */
  speed?: PlaybackSpeed;
  /** Bubbles play-state changes back to the parent when `playing` is controlled. */
  onPlayingChange?: (playing: boolean) => void;
  /** Bubbles speed changes back to the parent when `speed` is controlled. */
  onSpeedChange?: (speed: PlaybackSpeed) => void;
  /**
   * Notified whenever the playhead advances past one or more event timestamps.
   * The argument lists the *newly crossed* events in chronological order. Used
   * by the rest of the TraceDashboard to highlight or open the current event.
   */
  onPlayheadCross?: (crossed: readonly TraceEventT[]) => void;
  /**
   * Test seam: defaults to `performance.now`. Allows the unit test to feed a
   * deterministic clock without monkey-patching globals.
   */
  now?: () => number;
  /** Test seam: defaults to `window.requestAnimationFrame`. */
  raf?: (cb: FrameRequestCallback) => number;
  /** Test seam: defaults to `window.cancelAnimationFrame`. */
  caf?: (handle: number) => void;
  /** Stable test id prefix so two scrubbers in compare mode don't collide. */
  testIdPrefix?: string;
}

interface ParsedEvent {
  readonly event: TraceEventT;
  readonly offsetMs: number;
}

function parseEvents(events: readonly TraceEventT[]): {
  readonly parsed: readonly ParsedEvent[];
  readonly durationMs: number;
} {
  if (events.length === 0) return { parsed: [], durationMs: 0 };
  const sorted = events.map((e) => ({
    event: e,
    time: Date.parse(e.timestamp),
  }));
  sorted.sort((a, b) => a.time - b.time);
  const start = sorted[0]!.time;
  const end = sorted[sorted.length - 1]!.time;
  const parsed = sorted.map(({ event, time }) => ({
    event,
    offsetMs: Math.max(0, time - start),
  }));
  return { parsed, durationMs: Math.max(0, end - start) };
}

export function TimelineScrubber({
  events,
  playing: playingProp,
  speed: speedProp,
  onPlayingChange,
  onSpeedChange,
  onPlayheadCross,
  now,
  raf,
  caf,
  testIdPrefix = "timeline-scrubber",
}: TimelineScrubberProps): JSX.Element {
  const [internalPlaying, setInternalPlaying] = useState(false);
  const [internalSpeed, setInternalSpeed] = useState<PlaybackSpeed>(1);
  const [playheadMs, setPlayheadMs] = useState<number>(0);

  const playing = playingProp ?? internalPlaying;
  const speed = speedProp ?? internalSpeed;

  const { parsed, durationMs } = useMemo(() => parseEvents(events), [events]);

  // Index of the next event to fire (i.e. last event already crossed = next-1).
  const nextEventIdxRef = useRef<number>(0);
  const playheadRef = useRef<number>(0);
  const speedRef = useRef<number>(speed);
  const lastFrameRef = useRef<number | null>(null);
  const rafHandleRef = useRef<number | null>(null);

  // Keep refs in sync so the rAF closure always sees fresh values.
  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  useEffect(() => {
    playheadRef.current = playheadMs;
  }, [playheadMs]);

  const setPlaying = useCallback(
    (next: boolean): void => {
      if (playingProp === undefined) setInternalPlaying(next);
      onPlayingChange?.(next);
    },
    [onPlayingChange, playingProp],
  );

  const setSpeed = useCallback(
    (next: PlaybackSpeed): void => {
      if (speedProp === undefined) setInternalSpeed(next);
      onSpeedChange?.(next);
    },
    [onSpeedChange, speedProp],
  );

  const seekTo = useCallback(
    (ms: number): void => {
      const clamped = Math.max(0, Math.min(ms, durationMs));
      playheadRef.current = clamped;
      setPlayheadMs(clamped);
      // An event is "already crossed" only if its offset is strictly less
      // than the new playhead position -- that way an event sitting at
      // exactly the playhead still fires when playback resumes from there
      // (this is why seeking back to 0 re-replays event #0).
      let i = 0;
      while (i < parsed.length && parsed[i]!.offsetMs < clamped) i++;
      nextEventIdxRef.current = i;
    },
    [durationMs, parsed],
  );

  // Re-seek to 0 whenever the underlying event list changes.
  useEffect(() => {
    seekTo(0);
  }, [events, seekTo]);

  // The rAF loop -- only mounted while `playing` is true. The dependency on
  // `playing` (and not on `playheadMs`) is intentional: we don't want to
  // re-register the loop on every frame.
  useEffect(() => {
    if (!playing) {
      lastFrameRef.current = null;
      if (rafHandleRef.current !== null) {
        (caf ?? cancelAnimationFrame)(rafHandleRef.current);
        rafHandleRef.current = null;
      }
      return;
    }
    if (durationMs <= 0) {
      // Nothing to advance through -- stop immediately.
      setPlaying(false);
      return;
    }

    const clock = now ?? (() => performance.now());
    const scheduler =
      raf ?? ((cb: FrameRequestCallback) => requestAnimationFrame(cb));
    const cancel = caf ?? ((h: number) => cancelAnimationFrame(h));

    const tick = (): void => {
      const t = clock();
      const last = lastFrameRef.current;
      const dt = last === null ? 0 : t - last;
      lastFrameRef.current = t;

      const prev = playheadRef.current;
      const next = Math.min(durationMs, prev + dt * speedRef.current);
      playheadRef.current = next;
      setPlayheadMs(next);

      // Emit any newly-crossed events.
      const crossed: TraceEventT[] = [];
      while (
        nextEventIdxRef.current < parsed.length &&
        parsed[nextEventIdxRef.current]!.offsetMs <= next
      ) {
        crossed.push(parsed[nextEventIdxRef.current]!.event);
        nextEventIdxRef.current++;
      }
      if (crossed.length > 0) onPlayheadCross?.(crossed);

      if (next >= durationMs) {
        setPlaying(false);
        return;
      }
      rafHandleRef.current = scheduler(tick);
    };

    rafHandleRef.current = scheduler(tick);
    return () => {
      if (rafHandleRef.current !== null) {
        cancel(rafHandleRef.current);
        rafHandleRef.current = null;
      }
      lastFrameRef.current = null;
    };
  }, [playing, durationMs, parsed, now, raf, caf, onPlayheadCross, setPlaying]);

  const togglePlay = useCallback((): void => {
    if (playing) {
      setPlaying(false);
      return;
    }
    // Resuming from end? Rewind first so the user gets the full replay.
    if (playheadRef.current >= durationMs) seekTo(0);
    setPlaying(true);
  }, [playing, durationMs, seekTo, setPlaying]);

  const goToStart = useCallback((): void => {
    setPlaying(false);
    seekTo(0);
  }, [seekTo, setPlaying]);

  const goToEnd = useCallback((): void => {
    setPlaying(false);
    seekTo(durationMs);
  }, [durationMs, seekTo, setPlaying]);

  const handleSpeed = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>): void => {
      const v = Number(e.target.value);
      if (PLAYBACK_SPEEDS.includes(v as PlaybackSpeed)) {
        setSpeed(v as PlaybackSpeed);
      }
    },
    [setSpeed],
  );

  const handleSlider = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>): void => {
      seekTo(Number(e.target.value));
    },
    [seekTo],
  );

  // Events crossed *so far* (used by the visible event list rendered below).
  const crossedEvents = useMemo<readonly TraceEventT[]>(() => {
    const out: TraceEventT[] = [];
    for (const p of parsed) {
      if (p.offsetMs > playheadMs) break;
      out.push(p.event);
    }
    return out;
  }, [parsed, playheadMs]);

  return (
    <div
      data-testid={testIdPrefix}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-2)",
        padding: "var(--space-2)",
        border: "1px solid var(--border-1)",
        borderRadius: "var(--radius-md)",
      }}
    >
      <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
        <button
          type="button"
          data-testid={`${testIdPrefix}-toggle`}
          onClick={togglePlay}
          aria-label={playing ? "Pause" : "Play"}
          disabled={durationMs <= 0}
        >
          {playing ? "Pause" : "Play"}
        </button>
        <button
          type="button"
          data-testid={`${testIdPrefix}-go-start`}
          onClick={goToStart}
          aria-label="Go to start"
        >
          |&lt;
        </button>
        <button
          type="button"
          data-testid={`${testIdPrefix}-go-end`}
          onClick={goToEnd}
          aria-label="Go to end"
          disabled={durationMs <= 0}
        >
          &gt;|
        </button>
        <label style={{ display: "inline-flex", gap: "var(--space-1)", alignItems: "center" }}>
          Speed:
          <select
            data-testid={`${testIdPrefix}-speed`}
            value={speed}
            onChange={handleSpeed}
            aria-label="Playback speed"
          >
            {PLAYBACK_SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s}x
              </option>
            ))}
          </select>
        </label>
        <span
          data-testid={`${testIdPrefix}-playhead`}
          style={{ color: "var(--fg-muted)", fontFamily: "var(--font-mono)" }}
        >
          {(playheadMs / 1000).toFixed(2)}s / {(durationMs / 1000).toFixed(2)}s
        </span>
      </div>

      <input
        type="range"
        min={0}
        max={durationMs}
        step={1}
        value={playheadMs}
        onChange={handleSlider}
        data-testid={`${testIdPrefix}-slider`}
        aria-label="Timeline scrubber"
      />

      {/* Tick marks for each event timestamp, rendered as a thin overlay. */}
      <div
        data-testid={`${testIdPrefix}-ticks`}
        style={{
          position: "relative",
          height: "8px",
          background: "var(--bg-1)",
          borderRadius: "4px",
        }}
      >
        {parsed.map((p, idx) => {
          const left = durationMs > 0 ? (p.offsetMs / durationMs) * 100 : 0;
          return (
            <span
              key={`${p.event.id}-${idx}`}
              data-testid={`${testIdPrefix}-tick-${p.event.id}`}
              style={{
                position: "absolute",
                left: `${left}%`,
                top: 0,
                bottom: 0,
                width: "2px",
                background: "var(--fg-muted)",
              }}
            />
          );
        })}
      </div>

      <ul
        data-testid={`${testIdPrefix}-crossed-list`}
        style={{ listStyle: "none", margin: 0, padding: 0 }}
      >
        {crossedEvents.map((e) => (
          <li
            key={e.id}
            data-testid={`${testIdPrefix}-crossed-${e.id}`}
            style={{
              padding: "var(--space-1)",
              fontFamily: "var(--font-mono)",
              fontSize: "0.85rem",
            }}
          >
            [{e.kind}] {e.summary}
          </li>
        ))}
      </ul>
    </div>
  );
}
