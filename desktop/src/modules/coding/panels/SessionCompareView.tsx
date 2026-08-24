import { useCallback, useState } from "react";
import type {
  CodingSessionSummaryT,
  TraceEventT,
} from "../../../../sidecar/src/protocol";
import { Button, Select } from "../../../components/ui";
import {
  PLAYBACK_SPEEDS,
  TimelineScrubber,
  type PlaybackSpeed,
} from "./TimelineScrubber";

export interface SessionCompareViewProps {
  /** First (left) session metadata. */
  sessionA: CodingSessionSummaryT;
  /** First (left) session events. */
  eventsA: readonly TraceEventT[];
  /** Second (right) session metadata. */
  sessionB: CodingSessionSummaryT;
  /** Second (right) session events. */
  eventsB: readonly TraceEventT[];
  onCloseCompare?: () => void;
  /** Test seam: shared clock for deterministic rAF in unit tests. */
  now?: () => number;
  raf?: (cb: FrameRequestCallback) => number;
  caf?: (handle: number) => void;
}

interface DiffRow {
  readonly index: number;
  readonly a: TraceEventT | null;
  readonly b: TraceEventT | null;
  readonly differs: boolean;
}

function diffEvents(
  a: readonly TraceEventT[],
  b: readonly TraceEventT[],
): readonly DiffRow[] {
  const maxLen = Math.max(a.length, b.length);
  const rows: DiffRow[] = [];
  for (let i = 0; i < maxLen; i++) {
    const left = a[i] ?? null;
    const right = b[i] ?? null;
    const differs =
      left === null ||
      right === null ||
      left.kind !== right.kind ||
      left.summary !== right.summary;
    rows.push({ index: i, a: left, b: right, differs });
  }
  return rows;
}

export function SessionCompareView({
  sessionA,
  eventsA,
  sessionB,
  eventsB,
  onCloseCompare,
  now,
  raf,
  caf,
}: SessionCompareViewProps): JSX.Element {
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<PlaybackSpeed>(1);
  const [crossedA, setCrossedA] = useState<readonly TraceEventT[]>([]);
  const [crossedB, setCrossedB] = useState<readonly TraceEventT[]>([]);

  const handleCrossedA = useCallback((crossed: readonly TraceEventT[]) => {
    setCrossedA((prev) => [...prev, ...crossed]);
  }, []);
  const handleCrossedB = useCallback((crossed: readonly TraceEventT[]) => {
    setCrossedB((prev) => [...prev, ...crossed]);
  }, []);

  const handleSharedSpeed = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const v = Number(e.target.value);
    if (PLAYBACK_SPEEDS.includes(v as PlaybackSpeed)) {
      setSpeed(v as PlaybackSpeed);
    }
  }, []);

  const togglePlay = useCallback(() => {
    setPlaying((p) => !p);
  }, []);

  // The diff pane is computed from the events crossed so far in each
  // session, so it updates incrementally as the linked playhead advances.
  const diffRows = diffEvents(crossedA, crossedB);

  return (
    <section
      data-testid="session-compare"
      aria-label="Compare two sessions"
      style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}
    >
      <header style={{ display: "flex", gap: "var(--space-3)", alignItems: "center" }}>
        <strong>Compare</strong>
        <Button
          type="button"
          testId="session-compare-shared-toggle"
          onClick={togglePlay}
        >
          {playing ? "Pause both" : "Play both"}
        </Button>
        <label style={{ display: "inline-flex", gap: "var(--space-1)", alignItems: "center" }}>
          Shared speed:
          <Select
            data-testid="session-compare-shared-speed"
            value={speed}
            onChange={handleSharedSpeed}
            aria-label="Shared playback speed"
            style={{ width: "auto" }}
          >
            {PLAYBACK_SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s}x
              </option>
            ))}
          </Select>
        </label>
        {onCloseCompare && (
          <Button
            type="button"
            testId="session-compare-close"
            variant="ghost"
            onClick={onCloseCompare}
          >
            Close compare
          </Button>
        )}
      </header>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "var(--space-3)",
        }}
      >
        <div data-testid="session-compare-a">
          <header style={{ fontWeight: 600 }}>
            A: {sessionA.title} ({sessionA.sessionId.slice(0, 8)})
          </header>
          <TimelineScrubber
            events={eventsA}
            playing={playing}
            speed={speed}
            onPlayingChange={setPlaying}
            onSpeedChange={setSpeed}
            onPlayheadCross={handleCrossedA}
            now={now}
            raf={raf}
            caf={caf}
            testIdPrefix="session-compare-scrubber-a"
          />
        </div>
        <div data-testid="session-compare-b">
          <header style={{ fontWeight: 600 }}>
            B: {sessionB.title} ({sessionB.sessionId.slice(0, 8)})
          </header>
          <TimelineScrubber
            events={eventsB}
            playing={playing}
            speed={speed}
            onPlayingChange={setPlaying}
            onSpeedChange={setSpeed}
            onPlayheadCross={handleCrossedB}
            now={now}
            raf={raf}
            caf={caf}
            testIdPrefix="session-compare-scrubber-b"
          />
        </div>
      </div>

      <section
        data-testid="session-compare-diff"
        aria-label="Event-by-event diff"
        style={{ marginTop: "var(--space-3)" }}
      >
        <header style={{ fontWeight: 600 }}>Diff (at current playhead)</header>
        {diffRows.length === 0 ? (
          <p data-testid="session-compare-diff-empty" style={{ color: "var(--fg-muted)" }}>
            No crossed events yet.
          </p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>#</th>
                <th style={{ textAlign: "left" }}>A</th>
                <th style={{ textAlign: "left" }}>B</th>
              </tr>
            </thead>
            <tbody>
              {diffRows.map((row) => (
                <tr
                  key={row.index}
                  data-testid={`session-compare-diff-row-${row.index}`}
                  data-differs={row.differs ? "true" : "false"}
                  style={{
                    background: row.differs
                      ? "rgba(255, 80, 80, 0.08)"
                      : "transparent",
                  }}
                >
                  <td style={{ fontFamily: "var(--font-mono)" }}>{row.index}</td>
                  <td style={{ fontFamily: "var(--font-mono)" }}>
                    {row.a ? `[${row.a.kind}] ${row.a.summary}` : "-"}
                  </td>
                  <td style={{ fontFamily: "var(--font-mono)" }}>
                    {row.b ? `[${row.b.kind}] ${row.b.summary}` : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </section>
  );
}
