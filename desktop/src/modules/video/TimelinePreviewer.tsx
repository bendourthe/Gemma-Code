/**
 * v1.0.0 Phase 7.2 -- Timeline previewer for completed clips.
 *
 * RETAINED, NOT DEAD (v1.15.0 Phase 8 refactor triage): the Phase 6 chat
 * redesign plays finished clips with native controls inside the message bubble,
 * so nothing mounts this today -- but it stays (and stays unit-tested) for the
 * deferred frame-accurate review affordance. See known gap IRSC.P6.A.
 *
 * Wraps an HTML5 `<video>` element with frame-accurate stepping
 * controls. The scrubber is a `<input type="range">` bound to
 * `video.currentTime`; the step buttons advance/retreat by 1/fps so
 * the user can step one frame at a time after a clip finishes
 * generating.
 *
 * The component is purely presentational -- it takes an `src` URL plus
 * an `fps` hint and emits no IPC of its own. Tests inject a fake
 * `<video>` element through React's normal render path; the scrubber
 * + step buttons are exercised without playing real media.
 */

import { useEffect, useRef, useState } from "react";

export interface TimelinePreviewerProps {
  readonly src: string | null;
  readonly fps: number;
  readonly testId?: string;
}

export function TimelinePreviewer({
  src,
  fps,
  testId = "video-timeline-previewer",
}: TimelinePreviewerProps): JSX.Element {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);

  useEffect(() => {
    setCurrentTime(0);
  }, [src]);

  function handleScrub(value: number): void {
    const video = videoRef.current;
    if (video) {
      video.currentTime = value;
    }
    setCurrentTime(value);
  }

  function stepFrame(deltaFrames: number): void {
    if (!Number.isFinite(fps) || fps <= 0) return;
    const upper = duration > 0 ? duration : Number.POSITIVE_INFINITY;
    const next = clamp(currentTime + deltaFrames / fps, 0, upper);
    handleScrub(next);
  }

  if (!src) {
    return (
      <div data-testid={testId} style={previewerEmptyStyle}>
        <p data-testid={`${testId}-empty`} style={{ color: "var(--fg-muted)" }}>
          Generated clips appear here once a job completes.
        </p>
      </div>
    );
  }

  return (
    <div data-testid={testId} style={previewerStyle}>
      <video
        data-testid={`${testId}-video`}
        ref={videoRef}
        src={src}
        controls={false}
        onLoadedMetadata={(e) =>
          setDuration((e.currentTarget as HTMLVideoElement).duration || 0)
        }
        onTimeUpdate={(e) =>
          setCurrentTime((e.currentTarget as HTMLVideoElement).currentTime || 0)
        }
        style={{ maxWidth: "100%", maxHeight: "60vh", background: "var(--bg-1)" }}
      />
      <div style={{ display: "flex", gap: "var(--space-1)", alignItems: "center" }}>
        <button
          data-testid={`${testId}-step-back`}
          type="button"
          onClick={() => stepFrame(-1)}
        >
          Prev frame
        </button>
        <button
          data-testid={`${testId}-play`}
          type="button"
          onClick={() => {
            const result = videoRef.current?.play();
            if (result && typeof (result as Promise<void>).catch === "function") {
              (result as Promise<void>).catch(() => undefined);
            }
          }}
        >
          Play
        </button>
        <button
          data-testid={`${testId}-pause`}
          type="button"
          onClick={() => {
            try {
              videoRef.current?.pause();
            } catch {
              // jsdom may throw if there's no media source; ignore.
            }
          }}
        >
          Pause
        </button>
        <button
          data-testid={`${testId}-step-forward`}
          type="button"
          onClick={() => stepFrame(1)}
        >
          Next frame
        </button>
        <input
          data-testid={`${testId}-scrubber`}
          type="range"
          min={0}
          max={duration > 0 ? duration : 60}
          step={1 / Math.max(fps, 1)}
          value={currentTime}
          onChange={(e) => handleScrub(Number(e.target.value))}
          style={{ flex: 1 }}
        />
        <span data-testid={`${testId}-timecode`}>
          {currentTime.toFixed(2)}s / {duration.toFixed(2)}s
        </span>
      </div>
    </div>
  );
}

const previewerStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-2)",
};

const previewerEmptyStyle: React.CSSProperties = {
  ...previewerStyle,
  background: "var(--bg-1)",
  borderRadius: "var(--radius-md)",
  padding: "var(--space-4)",
  alignItems: "center",
  justifyContent: "center",
};

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}
