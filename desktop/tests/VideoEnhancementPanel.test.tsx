import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  VideoEnhancementPanel,
  deriveVideoEnhancementTarget,
} from "../src/modules/video/VideoEnhancementPanel";
import {
  VideoEnhancementClientError,
  type VideoEnhancementCapabilityDto,
  type VideoEnhancementClient,
  type VideoEnhancementEnqueueInput,
  type VideoEnhancementJobDto,
} from "../src/modules/video/videoEnhancementClient";

const ISO = "2026-08-28T12:00:00.000Z";
const HASH = "a".repeat(64);
const originalMatchMedia = window.matchMedia;

afterEach(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: originalMatchMedia,
  });
});

function readyCapability(
  presets: Partial<VideoEnhancementCapabilityDto["presets"]> = {},
): VideoEnhancementCapabilityDto {
  const available = { state: "available" as const, reason: null };
  return {
    status: "ready",
    reason: null,
    backend: {
      id: "video2x",
      compatibilityId: "video2x-6",
      version: "6.4.0",
      executableSha256: HASH,
      provenance: "user-supplied-unverified",
      configurationSource: "setting",
    },
    platform: { os: "win32", architecture: "x64", avx2: "available" },
    devices: [
      { id: 0, type: "discrete_gpu", name: "Local GPU", selected: true },
    ],
    presets: {
      "animation-upscale-2x": available,
      "animation-upscale-4x": available,
      "general-upscale-4x": available,
      "smooth-2x": available,
      ...presets,
    },
    probedAt: ISO,
    diagnostic: null,
  };
}

function unavailableCapability(): VideoEnhancementCapabilityDto {
  const unavailable = {
    state: "unavailable" as const,
    reason: "No Vulkan device",
  };
  return {
    ...readyCapability(),
    status: "unavailable",
    reason: "no_vulkan_device",
    presets: {
      "animation-upscale-2x": unavailable,
      "animation-upscale-4x": unavailable,
      "general-upscale-4x": unavailable,
      "smooth-2x": unavailable,
    },
  };
}

function source() {
  return {
    path: "C:/videos/source.mp4",
    sha256: HASH,
    sizeBytes: 1_024,
    durationSeconds: 4,
    width: 1_920,
    height: 1_080,
    frameRate: { numerator: 30_000, denominator: 1_001 },
  } as const;
}

function job(
  state: VideoEnhancementJobDto["state"] = "queued",
  overrides: Partial<VideoEnhancementJobDto> = {},
): VideoEnhancementJobDto {
  return {
    childJobId: "child-a",
    parentJobId: "parent-a",
    sourceOutputId: "output-a",
    backendId: "video2x",
    state,
    priority: "interactive",
    estimatedVramGB: 4,
    request: {
      requestId: "request-a",
      parentJobId: "parent-a",
      source: source(),
      requestedAt: ISO,
      timeoutMs: 60_000,
      mode: "upscale",
      upscalePreset: "animation-upscale-2x",
    },
    idempotencyKey: null,
    attempt: 1,
    retryOfChildJobId: null,
    cancelRequested: false,
    progress: null,
    error: null,
    output: null,
    createdAt: ISO,
    startedAt: state === "queued" ? null : ISO,
    finishedAt: null,
    ...overrides,
  };
}

function succeededJob(): VideoEnhancementJobDto {
  return job("succeeded", {
    finishedAt: "2026-08-28T12:00:04.000Z",
    progress: {
      requestId: "request-a",
      childJobId: "child-a",
      stage: "publish",
      stageIndex: 4,
      stageCount: 4,
      processedFrames: 120,
      totalFrames: 120,
      percent: 100,
      elapsedMs: 4_000,
      message: "Published",
    },
    output: {
      outputId: "enhanced-output-a",
      path: "C:/videos/source-enhanced.mp4",
      contentHash: HASH,
      sizeBytes: 2_048,
      durationSeconds: 4,
      width: 3_840,
      height: 2_160,
      frameRate: { numerator: 30_000, denominator: 1_001 },
      provenanceRecordId: "provenance-a",
      preProvenanceContainerSha256: HASH,
      publishedContainerSha256: HASH,
      workflow: {},
      durableProvenance: {},
    },
  });
}

function createClient(input?: {
  capability?: VideoEnhancementCapabilityDto;
  jobs?: readonly VideoEnhancementJobDto[];
}): VideoEnhancementClient {
  const currentJobs = input?.jobs ?? [];
  return {
    capability: vi
      .fn()
      .mockResolvedValue(input?.capability ?? readyCapability()),
    enqueue: vi.fn(async (request: VideoEnhancementEnqueueInput) => {
      const requestShape =
        request.mode === "upscale"
          ? { mode: request.mode, upscalePreset: request.upscalePreset }
          : request.mode === "interpolate"
            ? {
                mode: request.mode,
                interpolationPreset: request.interpolationPreset,
              }
            : {
                mode: request.mode,
                upscalePreset: request.upscalePreset,
                interpolationPreset: request.interpolationPreset,
              };
      return {
        created: true,
        job: job("queued", {
          request: {
            requestId: "request-created",
            parentJobId: request.parentJobId,
            source: source(),
            requestedAt: ISO,
            timeoutMs: 60_000,
            ...requestShape,
          } as VideoEnhancementJobDto["request"],
        }),
      };
    }),
    list: vi.fn().mockResolvedValue(currentJobs),
    cancel: vi.fn().mockResolvedValue(null),
  };
}

function renderPanel(
  client: VideoEnhancementClient,
  input: Partial<React.ComponentProps<typeof VideoEnhancementPanel>> = {},
) {
  const onClose = input.onClose ?? vi.fn();
  const result = render(
    <VideoEnhancementPanel
      parentJobId="parent-a"
      sourceOutputId="output-a"
      sourceWidth={1_920}
      sourceHeight={1_080}
      sourceFrameRate={{ numerator: 30_000, denominator: 1_001 }}
      client={client}
      pollIntervalMs={60_000}
      onClose={onClose}
      {...input}
    />,
  );
  return { ...result, onClose };
}

describe("VideoEnhancementPanel", () => {
  it("offers exactly seven semantic presets with exact derived dimensions and rational frame rates", async () => {
    const client = createClient();
    renderPanel(client);

    await waitFor(() =>
      expect(screen.getByTestId("video-enhancement-start")).toBeEnabled(),
    );
    expect(screen.getAllByRole("radio")).toHaveLength(7);
    expect(
      screen.getByText("Target: 3840 x 2160, 30000/1001 fps (29.97 fps)"),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText("Target: 7680 x 4320, 30000/1001 fps (29.97 fps)"),
    ).toHaveLength(2);
    expect(
      screen.getByText("Target: 1920 x 1080, 60000/1001 fps (59.94 fps)"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Target: 3840 x 2160, 60000/1001 fps (59.94 fps)"),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText("Target: 7680 x 4320, 60000/1001 fps (59.94 fps)"),
    ).toHaveLength(2);

    expect(
      deriveVideoEnhancementTarget(
        {
          width: 640,
          height: 360,
          frameRate: { numerator: 24_000, denominator: 1_001 },
        },
        "general-4x-smooth",
      ),
    ).toEqual({
      width: 2_560,
      height: 1_440,
      frameRate: { numerator: 48_000, denominator: 1_001 },
    });
    expect(screen.queryByRole("spinbutton")).toBeNull();
    expect(screen.queryByText(/command|processor|model flag/i)).toBeNull();
  });

  it("submits a combined semantic choice with only frozen identifiers", async () => {
    const client = createClient();
    renderPanel(client);
    await waitFor(() =>
      expect(screen.getByTestId("video-enhancement-start")).toBeEnabled(),
    );

    fireEvent.click(screen.getByDisplayValue("general-4x-smooth"));
    expect(
      screen.getByTestId("video-enhancement-selected-target"),
    ).toHaveTextContent("7680 x 4320, 60000/1001 fps");
    fireEvent.click(screen.getByTestId("video-enhancement-start"));

    await waitFor(() => expect(client.enqueue).toHaveBeenCalledTimes(1));
    expect(client.enqueue).toHaveBeenCalledWith({
      parentJobId: "parent-a",
      sourceOutputId: "output-a",
      priority: "interactive",
      mode: "upscale_interpolate",
      upscalePreset: "general-upscale-4x",
      interpolationPreset: "smooth-2x",
    });
    expect(
      Object.keys(vi.mocked(client.enqueue).mock.calls[0]![0]).sort(),
    ).toEqual([
      "interpolationPreset",
      "mode",
      "parentJobId",
      "priority",
      "sourceOutputId",
      "upscalePreset",
    ]);
  });

  it("disables every preset with a visible setup reason when the host capability is unavailable", async () => {
    const client = createClient({ capability: unavailableCapability() });
    renderPanel(client);

    await waitFor(() => expect(client.capability).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(screen.getByTestId("video-enhancement-start")).toBeDisabled(),
    );
    for (const radio of screen.getAllByRole("radio"))
      expect(radio).toBeDisabled();
    expect(screen.getAllByTestId(/^video-enhancement-unavailable-/)).toHaveLength(7);
    for (const reason of screen.getAllByTestId(/^video-enhancement-unavailable-/)) {
      expect(reason).toHaveTextContent("No compatible local Vulkan GPU was found.");
    }
    expect(screen.getByTestId("video-enhancement-live")).toHaveTextContent(
      "No compatible local Vulkan GPU was found.",
    );
  });

  it("renders known and indeterminate authoritative progress and cancels the exact child", async () => {
    const running = job("running", {
      progress: {
        requestId: "request-a",
        childJobId: "child-a",
        stage: "interpolate",
        stageIndex: 2,
        stageCount: 4,
        percent: 42.4,
        elapsedMs: 9_000,
        message: "Interpolating",
      },
    });
    const queued = job("queued", { childJobId: "child-b" });
    const cancelled = job("cancelled", {
      finishedAt: "2026-08-28T12:00:10.000Z",
      error: {
        code: "cancelled",
        message: "Enhancement cancelled.",
        retryable: true,
        stage: "interpolate",
        diagnostics: null,
        terminationConfirmed: true,
      },
    });
    const client = createClient({ jobs: [running, queued] });
    vi.mocked(client.cancel).mockResolvedValue(cancelled);
    renderPanel(client);

    const known = await screen.findByTestId(
      "video-enhancement-progress-child-a",
    );
    expect(known).toHaveAttribute("aria-valuenow", "42");
    expect(known).toHaveAttribute("aria-valuetext", "42% at interpolate");
    expect(screen.getByText("9s")).toBeInTheDocument();
    expect(screen.getAllByText("video2x")).toHaveLength(2);
    const indeterminate = screen.getByTestId(
      "video-enhancement-progress-child-b",
    );
    expect(indeterminate).not.toHaveAttribute("aria-valuenow");
    expect(indeterminate).toHaveAttribute(
      "aria-valuetext",
      "Progress is indeterminate at queued",
    );

    fireEvent.click(screen.getByTestId("video-enhancement-cancel-child-a"));
    await waitFor(() => expect(client.cancel).toHaveBeenCalledWith("child-a"));
    expect(client.cancel).not.toHaveBeenCalledWith("child-b");
    await waitFor(() =>
      expect(
        screen.getByTestId("video-enhancement-job-child-a"),
      ).toHaveTextContent("cancelled"),
    );
  });

  it("reports an authoritative succeeded DTO once and keeps the output separate", async () => {
    const completed = succeededJob();
    const client = createClient({ jobs: [completed] });
    const onComplete = vi.fn();
    const { rerender } = renderPanel(client, { onComplete });

    await waitFor(() => expect(onComplete).toHaveBeenCalledOnce());
    expect(onComplete).toHaveBeenCalledWith(completed);
    expect(
      screen.getByTestId("video-enhancement-output-child-a"),
    ).toHaveTextContent("A separate enhanced file is ready to download");
    expect(
      screen.getByText(/original video is preserved/i),
    ).toBeInTheDocument();

    rerender(
      <VideoEnhancementPanel
        parentJobId="parent-a"
        sourceOutputId="output-a"
        sourceWidth={1_920}
        sourceHeight={1_080}
        sourceFrameRate={{ numerator: 30_000, denominator: 1_001 }}
        client={client}
        pollIntervalMs={61_000}
        onClose={vi.fn()}
        onComplete={onComplete}
      />,
    );
    await waitFor(() => expect(client.list).toHaveBeenCalledTimes(2));
    expect(onComplete).toHaveBeenCalledOnce();
  });

  it("preserves the last job snapshot on polling failure and retries authoritatively", async () => {
    const running = job("running", {
      progress: {
        requestId: "request-a",
        childJobId: "child-a",
        stage: "upscale",
        stageIndex: 1,
        stageCount: 3,
        percent: 25,
        elapsedMs: 2_000,
        message: "Upscaling",
      },
    });
    const client = createClient();
    vi.mocked(client.list)
      .mockResolvedValueOnce([running])
      .mockRejectedValueOnce(new Error("sidecar unavailable"))
      .mockResolvedValue([running]);
    const props = {
      parentJobId: "parent-a",
      sourceOutputId: "output-a",
      sourceWidth: 1_920,
      sourceHeight: 1_080,
      sourceFrameRate: { numerator: 30_000, denominator: 1_001 },
      client,
      onClose: vi.fn(),
    } as const;
    const { rerender } = render(
      <VideoEnhancementPanel {...props} pollIntervalMs={60_000} />,
    );
    expect(
      await screen.findByTestId("video-enhancement-job-child-a"),
    ).toBeInTheDocument();

    rerender(<VideoEnhancementPanel {...props} pollIntervalMs={61_000} />);
    expect(
      await screen.findByTestId("video-enhancement-poll-error"),
    ).toHaveTextContent("last known status remains visible");
    expect(
      screen.getByTestId("video-enhancement-job-child-a"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retry job status" }));
    await waitFor(() =>
      expect(screen.queryByTestId("video-enhancement-poll-error")).toBeNull(),
    );
    expect(client.list).toHaveBeenCalledTimes(3);
  });

  it("maps typed job and enqueue failures to actionable local guidance", async () => {
    const failed = job("failed", {
      error: {
        code: "source_changed",
        message: "Source hash changed.",
        retryable: true,
        stage: "preflight",
        diagnostics: "expected a, observed b",
        terminationConfirmed: null,
      },
      finishedAt: ISO,
    });
    const client = createClient({ jobs: [failed] });
    vi.mocked(client.enqueue).mockRejectedValue(
      new VideoEnhancementClientError("Backend is offline.", {
        code: "backend_unavailable",
        message: "Backend is offline.",
        retryable: true,
        stage: "preflight",
        diagnostics: null,
        terminationConfirmed: null,
      }),
    );
    renderPanel(client);

    expect(await screen.findByText("Source hash changed.")).toBeInTheDocument();
    expect(
      screen.getByText(/It changed after this job was created/),
    ).toBeInTheDocument();
    expect(screen.getByText("Local diagnostics")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId("video-enhancement-start")).toBeEnabled(),
    );
    fireEvent.click(screen.getByTestId("video-enhancement-start"));
    expect(
      await screen.findByTestId("video-enhancement-operation-error"),
    ).toHaveTextContent(
      "Configure or restart the local Video2X backend, then retry.",
    );
  });

  it("uses one stable live region, focuses Close initially, and closes on click or Escape", async () => {
    const client = createClient();
    const onClose = vi.fn();
    renderPanel(client, { onClose });

    await waitFor(() =>
      expect(screen.getByTestId("video-enhancement-close")).toHaveFocus(),
    );
    expect(document.querySelectorAll("[aria-live]")).toHaveLength(1);
    expect(
      screen.getByRole("dialog", { name: "Enhance video" }),
    ).toHaveAttribute("aria-modal", "false");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByTestId("video-enhancement-close"));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("marks reduced motion and removes progress width transitions", async () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: vi.fn().mockReturnValue({
        matches: true,
        media: "(prefers-reduced-motion: reduce)",
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    });
    const running = job("running", {
      progress: {
        requestId: "request-a",
        childJobId: "child-a",
        stage: "upscale",
        stageIndex: 1,
        stageCount: 3,
        percent: 50,
        elapsedMs: 1_000,
        message: "Upscaling",
      },
    });
    renderPanel(createClient({ jobs: [running] }));

    await waitFor(() =>
      expect(screen.getByTestId("video-enhancement-panel")).toHaveAttribute(
        "data-reduced-motion",
        "true",
      ),
    );
    expect(
      screen.getByTestId("video-enhancement-progress-fill-child-a"),
    ).toHaveStyle({
      transition: "none",
    });
  });

  it.each([
    {
      selection: "animation-2x",
      expected: {
        mode: "upscale",
        upscalePreset: "animation-upscale-2x",
      },
    },
    {
      selection: "animation-4x",
      expected: {
        mode: "upscale",
        upscalePreset: "animation-upscale-4x",
      },
    },
    {
      selection: "general-4x",
      expected: {
        mode: "upscale",
        upscalePreset: "general-upscale-4x",
      },
    },
    {
      selection: "smooth-2x",
      expected: {
        mode: "interpolate",
        interpolationPreset: "smooth-2x",
      },
    },
    {
      selection: "animation-2x-smooth",
      expected: {
        mode: "upscale_interpolate",
        upscalePreset: "animation-upscale-2x",
        interpolationPreset: "smooth-2x",
      },
    },
    {
      selection: "animation-4x-smooth",
      expected: {
        mode: "upscale_interpolate",
        upscalePreset: "animation-upscale-4x",
        interpolationPreset: "smooth-2x",
      },
    },
  ] as const)(
    "maps $selection to a typed sidecar request",
    async ({ selection, expected }) => {
      const client = createClient();
      renderPanel(client);
      await waitFor(() =>
        expect(screen.getByTestId("video-enhancement-start")).toBeEnabled(),
      );
      fireEvent.click(screen.getByDisplayValue(selection));
      fireEvent.click(screen.getByTestId("video-enhancement-start"));
      await waitFor(() => expect(client.enqueue).toHaveBeenCalledTimes(1));
      expect(client.enqueue).toHaveBeenCalledWith({
        parentJobId: "parent-a",
        sourceOutputId: "output-a",
        priority: "interactive",
        ...expected,
      });
    },
  );

  it("disables only the unverified preset and keeps the others available", async () => {
    const client = createClient({
      capability: readyCapability({
        "smooth-2x": { state: "unverified", reason: "Model not verified" },
      }),
    });
    renderPanel(client);
    await waitFor(() =>
      expect(screen.getByTestId("video-enhancement-start")).toBeEnabled(),
    );
    expect(screen.getByDisplayValue("animation-2x")).toBeEnabled();
    expect(screen.getByDisplayValue("smooth-2x")).toBeDisabled();
    expect(
      screen.getByTestId("video-enhancement-unavailable-smooth-2x"),
    ).toHaveTextContent("Frame interpolation is not verified");
  });

  it("rechecks capability and disables presets when the host becomes unavailable", async () => {
    const client = createClient();
    vi.mocked(client.capability)
      .mockResolvedValueOnce(readyCapability())
      .mockResolvedValue(unavailableCapability());
    renderPanel(client);
    await waitFor(() =>
      expect(screen.getByTestId("video-enhancement-start")).toBeEnabled(),
    );
    fireEvent.click(screen.getByTestId("video-enhancement-recheck"));
    await waitFor(() =>
      expect(screen.getByTestId("video-enhancement-start")).toBeDisabled(),
    );
    expect(screen.getByDisplayValue("animation-2x")).toBeDisabled();
    expect(screen.getByTestId("video-enhancement-live")).toHaveTextContent(
      "No compatible local Vulkan GPU was found.",
    );
  });

  it("does not rewrite the live region on a successful status poll", async () => {
    const running = job("running", {
      progress: {
        requestId: "request-a",
        childJobId: "child-a",
        stage: "upscale",
        stageIndex: 1,
        stageCount: 3,
        percent: 20,
        elapsedMs: 1_000,
        message: "Upscaling",
      },
    });
    const client = createClient({ jobs: [running] });
    const props = {
      parentJobId: "parent-a",
      sourceOutputId: "output-a",
      sourceWidth: 1_920,
      sourceHeight: 1_080,
      sourceFrameRate: { numerator: 30_000, denominator: 1_001 },
      client,
      onClose: vi.fn(),
    } as const;
    const { rerender } = render(
      <VideoEnhancementPanel {...props} pollIntervalMs={60_000} />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("video-enhancement-live")).toHaveTextContent(
        "Local enhancement options are ready.",
      ),
    );
    rerender(<VideoEnhancementPanel {...props} pollIntervalMs={61_000} />);
    await waitFor(() => expect(client.list).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId("video-enhancement-live")).toHaveTextContent(
      "Local enhancement options are ready.",
    );
  });

  it("moves keyboard focus from Close to Recheck then the first available preset", async () => {
    const user = userEvent.setup();
    renderPanel(createClient());
    await waitFor(() =>
      expect(screen.getByTestId("video-enhancement-start")).toBeEnabled(),
    );
    expect(screen.getByTestId("video-enhancement-close")).toHaveFocus();
    await user.tab();
    expect(screen.getByTestId("video-enhancement-recheck")).toHaveFocus();
    await user.tab();
    expect(screen.getByDisplayValue("animation-2x")).toHaveFocus();
  });
});
