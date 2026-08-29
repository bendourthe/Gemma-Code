import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import type {
  RationalFrameRate,
  VideoEnhancementInterpolationPresetId,
  VideoEnhancementUpscalePresetId,
} from "../../../../core/video/VideoEnhancement";
import {
  expectedVideoEnhancementGeometry,
  videoEnhancementCapabilityCopy,
} from "../../../../core/video/videoEnhancementSupport";
import { Button } from "../../components/ui";
import { useReducedMotion } from "../../motion/useReducedMotion";
import {
  VideoEnhancementClientError,
  createIpcVideoEnhancementClient,
  isActiveVideoEnhancementJob,
  type VideoEnhancementCapabilityDto,
  type VideoEnhancementClient,
  type VideoEnhancementEnqueueInput,
  type VideoEnhancementJobDto,
  type VideoEnhancementRuntimeErrorDto,
} from "./videoEnhancementClient";

export type VideoEnhancementSelectionId =
  | "animation-2x"
  | "animation-4x"
  | "general-4x"
  | "smooth-2x"
  | "animation-2x-smooth"
  | "animation-4x-smooth"
  | "general-4x-smooth";

interface VideoEnhancementSelection {
  readonly id: VideoEnhancementSelectionId;
  readonly label: string;
  readonly description: string;
  readonly upscalePreset: VideoEnhancementUpscalePresetId | null;
  readonly interpolationPreset: VideoEnhancementInterpolationPresetId | null;
}

export const VIDEO_ENHANCEMENT_SELECTIONS: readonly VideoEnhancementSelection[] =
  Object.freeze([
    {
      id: "animation-2x",
      label: "Animation upscale 2x",
      description: "Double width and height with an animation-focused preset.",
      upscalePreset: "animation-upscale-2x",
      interpolationPreset: null,
    },
    {
      id: "animation-4x",
      label: "Animation upscale 4x",
      description:
        "Quadruple width and height with an animation-focused preset.",
      upscalePreset: "animation-upscale-4x",
      interpolationPreset: null,
    },
    {
      id: "general-4x",
      label: "General upscale 4x",
      description: "Quadruple width and height for general video content.",
      upscalePreset: "general-upscale-4x",
      interpolationPreset: null,
    },
    {
      id: "smooth-2x",
      label: "Smooth motion 2x",
      description:
        "Double the frame rate while keeping the original dimensions.",
      upscalePreset: null,
      interpolationPreset: "smooth-2x",
    },
    {
      id: "animation-2x-smooth",
      label: "Animation 2x + Smooth 2x",
      description: "Double dimensions and frame rate for animation.",
      upscalePreset: "animation-upscale-2x",
      interpolationPreset: "smooth-2x",
    },
    {
      id: "animation-4x-smooth",
      label: "Animation 4x + Smooth 2x",
      description:
        "Quadruple dimensions and double the frame rate for animation.",
      upscalePreset: "animation-upscale-4x",
      interpolationPreset: "smooth-2x",
    },
    {
      id: "general-4x-smooth",
      label: "General 4x + Smooth 2x",
      description:
        "Quadruple dimensions and double the frame rate for general video.",
      upscalePreset: "general-upscale-4x",
      interpolationPreset: "smooth-2x",
    },
  ] satisfies readonly VideoEnhancementSelection[]);

export interface VideoEnhancementSourceFacts {
  readonly width: number;
  readonly height: number;
  readonly frameRate: RationalFrameRate;
}

export interface VideoEnhancementTarget {
  readonly width: number;
  readonly height: number;
  readonly frameRate: RationalFrameRate;
}

export function deriveVideoEnhancementTarget(
  source: VideoEnhancementSourceFacts,
  selectionId: VideoEnhancementSelectionId,
): VideoEnhancementTarget {
  const selection = VIDEO_ENHANCEMENT_SELECTIONS.find(
    (candidate) => candidate.id === selectionId,
  );
  if (!selection)
    throw new Error(`Unknown video enhancement selection: ${selectionId}`);
  const geometry = expectedVideoEnhancementGeometry(
    {
      width: source.width,
      height: source.height,
      frameRate: source.frameRate,
      durationSeconds: 1,
    },
    {
      upscalePreset: selection.upscalePreset,
      interpolationPreset: selection.interpolationPreset,
    },
  );
  return {
    width: geometry.width,
    height: geometry.height,
    frameRate: geometry.frameRate,
  };
}

export interface VideoEnhancementPanelProps {
  readonly parentJobId: string;
  readonly sourceOutputId: string;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly sourceFrameRate: RationalFrameRate;
  readonly client?: VideoEnhancementClient;
  readonly pollIntervalMs?: number;
  readonly onClose: () => void;
  readonly onComplete?: (job: VideoEnhancementJobDto) => void;
  readonly testId?: string;
}

interface SelectionAvailability {
  readonly available: boolean;
  readonly reason: string | null;
}

interface UiFailure {
  readonly message: string;
  readonly action: string;
}

const terminalStates = new Set<VideoEnhancementJobDto["state"]>([
  "interrupted",
  "succeeded",
  "failed",
  "cancelled",
  "timed_out",
]);

const panelStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-4)",
  padding: "var(--space-5)",
  border: "1px solid var(--border-subtle)",
  borderRadius: "var(--radius-lg)",
  background: "var(--bg-elevated)",
  color: "var(--fg-0)",
};

const mutedStyle: CSSProperties = {
  margin: 0,
  color: "var(--fg-muted)",
  fontSize: "var(--text-sm)",
};

function capabilityReason(reason: string): string {
  return videoEnhancementCapabilityCopy(reason);
}

function availabilityFor(
  capability: VideoEnhancementCapabilityDto | null,
  selection: VideoEnhancementSelection,
): SelectionAvailability {
  if (!capability)
    return { available: false, reason: "Checking local capability..." };
  if (capability.status !== "ready") {
    return { available: false, reason: capabilityReason(capability.reason) };
  }
  const requirements = [
    selection.upscalePreset
      ? {
          label: "Upscaling",
          value: capability.presets[selection.upscalePreset],
        }
      : null,
    selection.interpolationPreset
      ? {
          label: "Frame interpolation",
          value: capability.presets[selection.interpolationPreset],
        }
      : null,
  ].filter((value) => value !== null);
  const issue = requirements.find(({ value }) => value.state !== "available");
  if (!issue) return { available: true, reason: null };
  const state =
    issue.value.state === "unverified" ? "is not verified" : "is unavailable";
  return {
    available: false,
    reason: `${issue.label} ${state}${issue.value.reason ? `: ${issue.value.reason}` : "."}`,
  };
}

function enqueueInput(
  selection: VideoEnhancementSelection,
  parentJobId: string,
  sourceOutputId: string,
): VideoEnhancementEnqueueInput {
  const common = {
    parentJobId,
    sourceOutputId,
    priority: "interactive" as const,
  };
  if (selection.upscalePreset && selection.interpolationPreset) {
    return {
      ...common,
      mode: "upscale_interpolate",
      upscalePreset: selection.upscalePreset,
      interpolationPreset: selection.interpolationPreset,
    };
  }
  if (selection.upscalePreset) {
    return {
      ...common,
      mode: "upscale",
      upscalePreset: selection.upscalePreset,
    };
  }
  return {
    ...common,
    mode: "interpolate",
    interpolationPreset: selection.interpolationPreset!,
  };
}

function selectionForJob(
  job: VideoEnhancementJobDto,
): VideoEnhancementSelectionId {
  const { request } = job;
  if (request.mode === "interpolate") return "smooth-2x";
  if (request.mode === "upscale") {
    if (request.upscalePreset === "animation-upscale-2x") return "animation-2x";
    if (request.upscalePreset === "animation-upscale-4x") return "animation-4x";
    return "general-4x";
  }
  if (request.upscalePreset === "animation-upscale-2x")
    return "animation-2x-smooth";
  if (request.upscalePreset === "animation-upscale-4x")
    return "animation-4x-smooth";
  return "general-4x-smooth";
}

function formatFrameRate(frameRate: RationalFrameRate): string {
  const decimal = frameRate.numerator / frameRate.denominator;
  return `${frameRate.numerator}/${frameRate.denominator} fps (${decimal.toFixed(2)} fps)`;
}

function formatTarget(target: VideoEnhancementTarget): string {
  return `${target.width} x ${target.height}, ${formatFrameRate(target.frameRate)}`;
}

function formatElapsed(job: VideoEnhancementJobDto): string {
  const progressElapsed = job.progress?.elapsedMs;
  let elapsedMs = progressElapsed ?? 0;
  if (progressElapsed === undefined && job.startedAt) {
    const end = job.finishedAt ? Date.parse(job.finishedAt) : Date.now();
    elapsedMs = Math.max(0, end - Date.parse(job.startedAt));
  }
  if (elapsedMs < 1_000) return "less than 1 second";
  const totalSeconds = Math.floor(elapsedMs / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function failureAction(detail: VideoEnhancementRuntimeErrorDto | null): string {
  if (!detail)
    return "Retry. If the problem continues, restart the local sidecar.";
  const actions: Record<VideoEnhancementRuntimeErrorDto["code"], string> = {
    invalid_request: "Refresh the source output and choose a preset again.",
    backend_unavailable:
      "Configure or restart the local Video2X backend, then retry.",
    unsupported_platform: "Use video enhancement on a supported local host.",
    incompatible_backend: "Update the configured Video2X build, then retry.",
    model_unavailable:
      "Install the required local enhancement model, then retry.",
    source_changed:
      "Reopen the source output. It changed after this job was created.",
    source_invalid: "Reopen or regenerate the source output, then retry.",
    output_conflict:
      "Retry after resolving the destination conflict. The original was preserved.",
    process_timeout:
      "Retry or choose a less demanding preset and keep Nexus open.",
    process_failed: "Review the local diagnostics, then retry.",
    cancelled: "No enhanced output was published. The original was preserved.",
    output_invalid:
      "Retry. The generated file failed validation and was not published.",
    provenance_failed:
      "Retry. Nexus did not publish an output without durable provenance.",
    publish_failed:
      "Retry. Nexus left the original untouched and did not claim publication.",
    internal_error:
      "Retry. If the problem continues, restart the local sidecar.",
    ineligible_source:
      "Choose a completed, indexed source video and try again.",
    id_conflict: "Refresh the job list before retrying this enhancement.",
    invalid_state:
      "Refresh the job list. This source is no longer in an eligible state.",
    not_found: "Reopen the source output because it is no longer available.",
    interrupted:
      "Retry the enhancement. The prior local process was interrupted.",
  };
  if (detail.terminationConfirmed === false) {
    return "The backend process may still be running. Check local processes before retrying.";
  }
  return actions[detail.code];
}

function uiFailure(error: unknown): UiFailure {
  if (error instanceof VideoEnhancementClientError) {
    return { message: error.message, action: failureAction(error.detail) };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { message, action: failureAction(null) };
}

function upsertJob(
  jobs: readonly VideoEnhancementJobDto[],
  incoming: VideoEnhancementJobDto,
): readonly VideoEnhancementJobDto[] {
  const found = jobs.some((job) => job.childJobId === incoming.childJobId);
  if (!found) return [incoming, ...jobs];
  return jobs.map((job) =>
    job.childJobId === incoming.childJobId ? incoming : job,
  );
}

function JobProgress({
  job,
  reducedMotion,
}: {
  readonly job: VideoEnhancementJobDto;
  readonly reducedMotion: boolean;
}): JSX.Element {
  const percent = job.progress?.percent;
  const known = typeof percent === "number";
  const displayPercent = known
    ? Math.round(Math.max(0, Math.min(100, percent)))
    : null;
  const stage =
    job.progress?.stage ?? (job.state === "queued" ? "queued" : job.state);
  const terminal = terminalStates.has(job.state);
  const target = deriveVideoEnhancementTarget(
    {
      width: job.request.source.width,
      height: job.request.source.height,
      frameRate: job.request.source.frameRate,
    },
    selectionForJob(job),
  );
  return (
    <article
      data-testid={`video-enhancement-job-${job.childJobId}`}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-2)",
        padding: "var(--space-3)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-md)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: "var(--space-3)",
        }}
      >
        <strong>
          {
            VIDEO_ENHANCEMENT_SELECTIONS.find(
              (item) => item.id === selectionForJob(job),
            )?.label
          }
        </strong>
        <span data-testid={`video-enhancement-job-state-${job.childJobId}`}>
          {job.state.replaceAll("_", " ")}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={`Enhancement ${job.childJobId} progress`}
        aria-valuemin={known ? 0 : undefined}
        aria-valuemax={known ? 100 : undefined}
        aria-valuenow={displayPercent ?? undefined}
        aria-valuetext={
          known
            ? `${displayPercent}% at ${stage}`
            : `Progress is indeterminate at ${stage}`
        }
        data-testid={`video-enhancement-progress-${job.childJobId}`}
        style={{
          height: "0.5rem",
          overflow: "hidden",
          borderRadius: "999px",
          background: "var(--bg-2)",
        }}
      >
        <span
          aria-hidden="true"
          data-testid={`video-enhancement-progress-fill-${job.childJobId}`}
          style={{
            display: "block",
            width: known ? `${displayPercent}%` : terminal ? "100%" : "35%",
            height: "100%",
            background:
              terminal && job.state !== "succeeded"
                ? "var(--status-warn)"
                : "var(--status-info)",
            transition: reducedMotion ? "none" : "width 160ms ease-out",
          }}
        />
      </div>
      <dl
        style={{
          display: "grid",
          gridTemplateColumns: "max-content 1fr",
          gap: "var(--space-1) var(--space-3)",
          margin: 0,
          fontSize: "var(--text-sm)",
        }}
      >
        <dt>Stage</dt>
        <dd style={{ margin: 0 }}>{stage}</dd>
        <dt>Elapsed</dt>
        <dd style={{ margin: 0 }}>{formatElapsed(job)}</dd>
        <dt>Backend</dt>
        <dd style={{ margin: 0 }}>{job.backendId}</dd>
        <dt>Target</dt>
        <dd style={{ margin: 0 }}>{formatTarget(target)}</dd>
      </dl>
      {job.error ? (
        <div data-testid={`video-enhancement-job-error-${job.childJobId}`}>
          <strong>{job.error.message}</strong>
          <p style={mutedStyle}>{failureAction(job.error)}</p>
          {job.error.diagnostics ? (
            <details>
              <summary>Local diagnostics</summary>
              <pre>{job.error.diagnostics}</pre>
            </details>
          ) : null}
        </div>
      ) : null}
      {job.output ? (
        <p
          data-testid={`video-enhancement-output-${job.childJobId}`}
          style={mutedStyle}
        >
          A separate enhanced file is ready to download. The original is
          unchanged.
        </p>
      ) : null}
    </article>
  );
}

export function VideoEnhancementPanel({
  parentJobId,
  sourceOutputId,
  sourceWidth,
  sourceHeight,
  sourceFrameRate,
  client: clientOverride,
  pollIntervalMs = 1_000,
  onClose,
  onComplete,
  testId = "video-enhancement-panel",
}: VideoEnhancementPanelProps): JSX.Element {
  const [client] = useState<VideoEnhancementClient>(
    () => clientOverride ?? createIpcVideoEnhancementClient(),
  );
  const [capability, setCapability] =
    useState<VideoEnhancementCapabilityDto | null>(null);
  const [capabilityFailure, setCapabilityFailure] = useState<UiFailure | null>(
    null,
  );
  const [capabilityLoading, setCapabilityLoading] = useState(true);
  const [jobs, setJobs] = useState<readonly VideoEnhancementJobDto[]>([]);
  const [jobsLoaded, setJobsLoaded] = useState(false);
  const [pollFailure, setPollFailure] = useState<UiFailure | null>(null);
  const [selectedId, setSelectedId] =
    useState<VideoEnhancementSelectionId>("animation-2x");
  const [enqueueing, setEnqueueing] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [operationFailure, setOperationFailure] = useState<UiFailure | null>(
    null,
  );
  const [liveMessage, setLiveMessage] = useState(
    "Loading local enhancement capability.",
  );
  const panelRef = useRef<HTMLElement>(null);
  const mountedRef = useRef(false);
  const reportedSuccesses = useRef(new Set<string>());
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    mountedRef.current = true;
    panelRef.current
      ?.querySelector<HTMLButtonElement>(
        "[data-testid='video-enhancement-close']",
      )
      ?.focus();
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const loadCapability = useCallback(async (): Promise<void> => {
    setCapabilityLoading(true);
    setCapabilityFailure(null);
    try {
      const next = await client.capability();
      if (!mountedRef.current) return;
      setCapability(next);
      setLiveMessage(
        next.status === "ready"
          ? "Local enhancement options are ready."
          : capabilityReason(next.reason),
      );
    } catch (error) {
      if (!mountedRef.current) return;
      const failure = uiFailure(error);
      setCapability(null);
      setCapabilityFailure(failure);
      setLiveMessage(`Capability check failed. ${failure.action}`);
    } finally {
      if (mountedRef.current) setCapabilityLoading(false);
    }
  }, [client]);

  const loadJobs = useCallback(async (): Promise<void> => {
    try {
      const next = await client.list(parentJobId);
      if (!mountedRef.current) return;
      setJobs(next);
      setJobsLoaded(true);
      setPollFailure(null);
    } catch (error) {
      if (!mountedRef.current) return;
      const failure = uiFailure(error);
      setJobsLoaded(true);
      setPollFailure(failure);
      setLiveMessage(
        `Job refresh failed. The last known status is still shown. ${failure.action}`,
      );
    }
  }, [client, parentJobId]);

  useEffect(() => {
    void loadCapability();
  }, [loadCapability]);

  useEffect(() => {
    void loadJobs();
    const intervalId = window.setInterval(
      () => void loadJobs(),
      pollIntervalMs,
    );
    return () => window.clearInterval(intervalId);
  }, [loadJobs, pollIntervalMs]);

  const availability = useMemo(
    () =>
      new Map(
        VIDEO_ENHANCEMENT_SELECTIONS.map((selection) => [
          selection.id,
          availabilityFor(capability, selection),
        ]),
      ),
    [capability],
  );

  useEffect(() => {
    if (availability.get(selectedId)?.available) return;
    const firstAvailable = VIDEO_ENHANCEMENT_SELECTIONS.find(
      (selection) => availability.get(selection.id)?.available,
    );
    if (firstAvailable) setSelectedId(firstAvailable.id);
  }, [availability, selectedId]);

  useEffect(() => {
    for (const job of jobs) {
      if (
        job.state !== "succeeded" ||
        !job.output ||
        reportedSuccesses.current.has(job.childJobId)
      ) {
        continue;
      }
      reportedSuccesses.current.add(job.childJobId);
      onComplete?.(job);
      setLiveMessage(
        "Enhancement complete. A separate synthesized file is ready to download.",
      );
    }
  }, [jobs, onComplete]);

  const selected =
    VIDEO_ENHANCEMENT_SELECTIONS.find(
      (selection) => selection.id === selectedId,
    ) ?? VIDEO_ENHANCEMENT_SELECTIONS[0]!;
  const selectedTarget = deriveVideoEnhancementTarget(
    { width: sourceWidth, height: sourceHeight, frameRate: sourceFrameRate },
    selected.id,
  );
  const selectedAvailability = availability.get(selected.id) ?? {
    available: false,
    reason: "Checking local capability...",
  };

  const startEnhancement = useCallback(async (): Promise<void> => {
    if (!selectedAvailability.available) return;
    setEnqueueing(true);
    setOperationFailure(null);
    setLiveMessage(`Starting ${selected.label}.`);
    try {
      const result = await client.enqueue(
        enqueueInput(selected, parentJobId, sourceOutputId),
      );
      if (!mountedRef.current) return;
      setJobs((current) => upsertJob(current, result.job));
      setLiveMessage(
        result.created
          ? `${selected.label} was queued as a separate child job.`
          : `The existing ${selected.label} child job was restored.`,
      );
    } catch (error) {
      if (!mountedRef.current) return;
      const failure = uiFailure(error);
      setOperationFailure(failure);
      setLiveMessage(`Enhancement could not start. ${failure.action}`);
    } finally {
      if (mountedRef.current) setEnqueueing(false);
    }
  }, [
    client,
    parentJobId,
    selected,
    selectedAvailability.available,
    sourceOutputId,
  ]);

  const cancelJob = useCallback(
    async (childJobId: string): Promise<void> => {
      setCancellingId(childJobId);
      setOperationFailure(null);
      setLiveMessage(`Cancelling enhancement job ${childJobId}.`);
      try {
        const cancelled = await client.cancel(childJobId);
        if (!mountedRef.current) return;
        if (!cancelled) {
          const failure = {
            message: "The enhancement job was not found.",
            action: "Refresh the job list before trying again.",
          };
          setOperationFailure(failure);
          setLiveMessage(`Cancellation was not confirmed. ${failure.action}`);
          return;
        }
        setJobs((current) => upsertJob(current, cancelled));
        setLiveMessage(
          cancelled.state === "cancelled"
            ? `Enhancement job ${childJobId} was cancelled. The original remains unchanged.`
            : `Cancellation was requested for enhancement job ${childJobId}.`,
        );
      } catch (error) {
        if (!mountedRef.current) return;
        const failure = uiFailure(error);
        setOperationFailure(failure);
        setLiveMessage(
          `Cancellation could not be confirmed. ${failure.action}`,
        );
      } finally {
        if (mountedRef.current) setCancellingId(null);
      }
    },
    [client],
  );

  return (
    <section
      ref={panelRef}
      role="dialog"
      aria-modal="false"
      aria-labelledby="video-enhancement-heading"
      data-testid={testId}
      data-reduced-motion={reducedMotion ? "true" : "false"}
      style={panelStyle}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: "var(--space-3)",
        }}
      >
        <div>
          <h2 id="video-enhancement-heading" style={{ margin: 0 }}>
            Enhance video
          </h2>
          <p style={mutedStyle}>
            Create a separate enhanced output from this completed video.
          </p>
        </div>
        <Button
          variant="ghost"
          testId="video-enhancement-close"
          onClick={onClose}
        >
          Close
        </Button>
      </div>

      <div
        style={{
          padding: "var(--space-3)",
          borderRadius: "var(--radius-md)",
          background: "var(--bg-1)",
        }}
      >
        <p style={{ margin: 0 }}>
          Enhancement synthesizes pixels and, for Smooth choices, frames. It
          cannot recover real detail or motion that was not recorded.
        </p>
        <p style={mutedStyle}>
          Artifacts can be amplified or introduced. Processing runs locally and
          can take substantial GPU time. Your original video is preserved; every
          enhancement is a separate child job and output.
        </p>
      </div>

      {capabilityFailure ? (
        <div data-testid="video-enhancement-capability-error">
          <strong>{capabilityFailure.message}</strong>
          <p style={mutedStyle}>{capabilityFailure.action}</p>
        </div>
      ) : null}
      <Button
        variant="ghost"
        testId="video-enhancement-recheck"
        onClick={() => void loadCapability()}
      >
        Recheck capability
      </Button>

      <fieldset
        disabled={capabilityLoading || enqueueing}
        style={{ margin: 0 }}
      >
        <legend>Enhancement preset</legend>
        <div
          style={{
            display: "grid",
            gap: "var(--space-2)",
            marginTop: "var(--space-2)",
          }}
        >
          {VIDEO_ENHANCEMENT_SELECTIONS.map((selection) => {
            const optionAvailability = availability.get(selection.id) ?? {
              available: false,
              reason: "Checking local capability...",
            };
            const target = deriveVideoEnhancementTarget(
              {
                width: sourceWidth,
                height: sourceHeight,
                frameRate: sourceFrameRate,
              },
              selection.id,
            );
            return (
              <label
                key={selection.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "auto 1fr",
                  gap: "var(--space-1) var(--space-2)",
                  padding: "var(--space-2)",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: "var(--radius-md)",
                  opacity: optionAvailability.available ? 1 : 0.72,
                }}
              >
                <input
                  type="radio"
                  name="video-enhancement-preset"
                  value={selection.id}
                  checked={selectedId === selection.id}
                  disabled={!optionAvailability.available}
                  onChange={() => setSelectedId(selection.id)}
                />
                <span>
                  <strong>{selection.label}</strong>
                  <span style={{ display: "block", ...mutedStyle }}>
                    {selection.description}
                  </span>
                  <span style={{ display: "block", ...mutedStyle }}>
                    Target: {formatTarget(target)}
                  </span>
                  {!optionAvailability.available ? (
                    <span
                      id={`video-enhancement-unavailable-${selection.id}`}
                      data-testid={`video-enhancement-unavailable-${selection.id}`}
                      style={{ display: "block", color: "var(--status-warn)" }}
                    >
                      {optionAvailability.reason}
                    </span>
                  ) : null}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <div>
        <strong>Selected target</strong>
        <p
          id="video-enhancement-selected-target"
          data-testid="video-enhancement-selected-target"
          style={mutedStyle}
        >
          {formatTarget(selectedTarget)}
        </p>
        <Button
          busy={enqueueing}
          disabled={!selectedAvailability.available}
          aria-describedby={
            selectedAvailability.available
              ? "video-enhancement-selected-target"
              : `video-enhancement-unavailable-${selected.id}`
          }
          testId="video-enhancement-start"
          onClick={() => void startEnhancement()}
        >
          {enqueueing ? "Starting..." : "Start enhancement"}
        </Button>
      </div>

      {operationFailure ? (
        <div data-testid="video-enhancement-operation-error">
          <strong>{operationFailure.message}</strong>
          <p style={mutedStyle}>{operationFailure.action}</p>
        </div>
      ) : null}

      <section aria-labelledby="video-enhancement-jobs-heading">
        <h3 id="video-enhancement-jobs-heading">Enhancement jobs</h3>
        {pollFailure ? (
          <div data-testid="video-enhancement-poll-error">
            <strong>Could not refresh job status.</strong>
            <p style={mutedStyle}>
              The last known status remains visible. {pollFailure.action}
            </p>
            <Button onClick={() => void loadJobs()}>Retry job status</Button>
          </div>
        ) : null}
        {!jobsLoaded ? (
          <p style={mutedStyle}>Loading enhancement jobs...</p>
        ) : null}
        {jobsLoaded && jobs.length === 0 ? (
          <p style={mutedStyle}>No enhancement jobs yet.</p>
        ) : null}
        <div style={{ display: "grid", gap: "var(--space-3)" }}>
          {jobs.map((job) => (
            <div key={job.childJobId}>
              <JobProgress job={job} reducedMotion={reducedMotion} />
              {isActiveVideoEnhancementJob(job) ? (
                <Button
                  variant="danger"
                  busy={cancellingId === job.childJobId}
                  disabled={job.cancelRequested}
                  testId={`video-enhancement-cancel-${job.childJobId}`}
                  onClick={() => void cancelJob(job.childJobId)}
                  style={{ marginTop: "var(--space-2)" }}
                >
                  {job.cancelRequested
                    ? "Cancellation requested"
                    : "Cancel enhancement"}
                </Button>
              ) : null}
            </div>
          ))}
        </div>
      </section>

      <p
        aria-live="polite"
        aria-atomic="true"
        data-testid="video-enhancement-live"
        style={{ ...mutedStyle, minHeight: "1.5em" }}
      >
        {liveMessage}
      </p>
    </section>
  );
}
