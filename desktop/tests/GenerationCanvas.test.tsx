import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  GenerationCanvas,
  MediaRuntimeRecoveryCard,
  Sam2RecoveryCard,
} from "../src/components/GenerationCanvas";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("MediaRuntimeRecoveryCard", () => {
  it("offers repair and a working log action for a repairable runtime", () => {
    const onRepair = vi.fn();
    const onOpenLog = vi.fn();
    render(
      <MediaRuntimeRecoveryCard
        state="repairable"
        code="CUDA_UNAVAILABLE"
        message="The installed PyTorch build cannot access the NVIDIA GPU."
        retryable
        progress={0}
        logPath="C:/Users/test/.nexus/logs/media-runtime-repair.log"
        onRepair={onRepair}
        onOpenLog={onOpenLog}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Media runtime needs attention",
    );
    fireEvent.click(screen.getByTestId("media-runtime-repair"));
    fireEvent.click(screen.getByTestId("media-runtime-open-log"));
    expect(onRepair).toHaveBeenCalledTimes(1);
    expect(onOpenLog).toHaveBeenCalledTimes(1);
  });

  it("shows bounded progress and cancellation while repairing", () => {
    const onCancel = vi.fn();
    render(
      <MediaRuntimeRecoveryCard
        state="repairing"
        code="REPAIRING"
        message="Repairing the local media runtime..."
        retryable={false}
        progress={0.42}
        onCancel={onCancel}
      />,
    );
    expect(screen.getByRole("progressbar")).toHaveAttribute("value", "0.42");
    expect(screen.getByText("42%")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("media-runtime-cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe("GenerationCanvas", () => {
  it("renders a busy aurora region with three drift layers and a shimmer bar", () => {
    const { container } = render(<GenerationCanvas />);
    const box = screen.getByTestId("generation-canvas");
    expect(box.getAttribute("role")).toBe("img");
    expect(box.getAttribute("aria-busy")).toBe("true");
    expect(box.getAttribute("aria-label")).toBe("Generating");
    expect(container.querySelectorAll(".nexus-aurora-layer")).toHaveLength(3);
    expect(container.querySelector(".nexus-aurora-shimmer")).not.toBeNull();
    expect(box).toHaveAttribute("data-reduced-motion", "false");
    const orb = screen.getByRole("img", { name: /agent creating/i });
    expect(orb).toHaveAttribute("data-agent-activity", "image-generation");
    expect(orb).toHaveAttribute("data-orb-size", "hero");
    const beam = screen.getByTestId("generation-canvas-beam");
    expect(beam).toHaveAttribute("data-beam-mode", "traveling");
    expect(beam).toHaveAttribute("data-beam-playing", "false");
    expect(beam).toHaveAttribute("data-beam-accent", "--accent-image");
    expect(box).toHaveAttribute("data-motion-winner", "orb");
  });

  it("overlays the live preview and materializes it with progress", () => {
    render(
      <GenerationCanvas
        previewSrc="data:image/png;base64,AAAA"
        progress={0.5}
        data-testid="gc"
      />,
    );
    const img = screen.getByTestId("gc-preview") as HTMLImageElement;
    expect(img.getAttribute("src")).toContain("base64,AAAA");
    // 0.35 + 0.65 * 0.5 = 0.675 -- the preview fades in with progress.
    expect(img.style.opacity).toBe("0.675");
  });

  it("omits the preview overlay when no previewSrc is given", () => {
    render(<GenerationCanvas data-testid="gc2" />);
    expect(screen.queryByTestId("gc2-preview")).toBeNull();
  });

  it("renders overlay children (e.g. the Video Lab thumbnail strip)", () => {
    render(
      <GenerationCanvas>
        <span data-testid="overlay-child">strip</span>
      </GenerationCanvas>,
    );
    expect(screen.getByTestId("overlay-child").textContent).toBe("strip");
  });

  it("clamps progress when out of range", () => {
    render(<GenerationCanvas previewSrc="x" progress={2} data-testid="gc3" />);
    // clamped to 1.0 -> opacity 1
    expect(
      (screen.getByTestId("gc3-preview") as HTMLElement).style.opacity,
    ).toBe("1");
  });

  it("marks reduced motion through the shared hook", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    render(<GenerationCanvas />);
    expect(screen.getByTestId("generation-canvas")).toHaveAttribute(
      "data-reduced-motion",
      "true",
    );
  });

  it("uses the video activity when tint is video", () => {
    render(<GenerationCanvas tint="video" />);
    expect(
      screen.getByRole("img", { name: /agent generating/i }),
    ).toHaveAttribute("data-agent-activity", "video-generation");
    expect(screen.getByTestId("generation-canvas-beam")).toHaveAttribute(
      "data-beam-accent",
      "--accent-video",
    );
  });
});

describe("Sam2RecoveryCard", () => {
  it("offers install, paint-mask, and settings without auto-installing", () => {
    const onInstall = vi.fn();
    const onPaint = vi.fn();
    render(
      <Sam2RecoveryCard
        modelId="sam2:hiera-tiny"
        message="SAM2 weights are not installed."
        onInstall={onInstall}
        onPaintMask={onPaint}
      />,
    );
    expect(screen.getByTestId("sam2-recovery")).toBeInTheDocument();
    expect(screen.getByTestId("sam2-install")).toHaveTextContent(
      "Install sam2:hiera-tiny",
    );
    fireEvent.click(screen.getByTestId("sam2-paint-mask"));
    expect(onPaint).toHaveBeenCalledTimes(1);
    expect(onInstall).not.toHaveBeenCalled();
    expect(screen.queryByTestId("sam2-retry")).toBeNull();
  });

  it("disables install when the sidecar is down and shows Retry after install", () => {
    const onRetry = vi.fn();
    const { rerender } = render(
      <Sam2RecoveryCard
        modelId="sam2:hiera-tiny"
        message="missing"
        installDisabled
        onRetry={onRetry}
      />,
    );
    expect(screen.getByTestId("sam2-install")).toBeDisabled();
    rerender(
      <Sam2RecoveryCard
        modelId="sam2:hiera-tiny"
        message="missing"
        installed
        onRetry={onRetry}
      />,
    );
    fireEvent.click(screen.getByTestId("sam2-retry"));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
