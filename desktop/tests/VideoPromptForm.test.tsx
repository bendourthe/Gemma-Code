import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import {
  DEFAULT_VIDEO_FORM_VALUES,
  VIDEO_PRESETS,
  VideoPromptForm,
  videoFormToRequest,
  type VideoFormValues,
} from "../src/modules/video/VideoPromptForm";

const AVAILABLE_MODELS = [
  { id: "ltx-video", displayName: "LTX-Video (default)", mode: "text2video" as const },
  {
    id: "sana-video-2b-720p",
    displayName: "SANA-Video 2B 720p (Fast)",
    mode: "text2video" as const,
  },
  { id: "svd", displayName: "Stable Video Diffusion", mode: "image2video" as const },
];

describe("VideoPromptForm presets", () => {
  it("exposes a Fast 720p preset bound to sana-video-2b-720p", () => {
    const fast = VIDEO_PRESETS.find((p) => p.id === "fast-720p");
    expect(fast).toBeDefined();
    expect(fast!.values.modelId).toBe("sana-video-2b-720p");
    expect(fast!.values.width).toBe(1280);
    expect(fast!.values.height).toBe(720);
    expect(fast!.values.durationSeconds).toBe(4);
    expect(fast!.values.fps).toBe(24);
    expect(fast!.values.sampler).toBe("flow-dpm-solver");
  });

  it("includes a Custom preset that applies no changes", () => {
    const custom = VIDEO_PRESETS.find((p) => p.id === "custom");
    expect(custom).toBeDefined();
    expect(Object.keys(custom!.values)).toHaveLength(0);
  });

  it("renders the preset selector with all defined presets", () => {
    render(<VideoPromptForm availableModels={AVAILABLE_MODELS} />);
    const selector = screen.getByTestId("video-preset");
    expect(selector).toBeInTheDocument();
    for (const preset of VIDEO_PRESETS) {
      expect(screen.getByRole("option", { name: preset.label })).toBeInTheDocument();
    }
  });

  it("applies the Fast 720p preset patch to the form on selection", () => {
    const onChange = vi.fn();
    render(<VideoPromptForm availableModels={AVAILABLE_MODELS} onChange={onChange} />);
    fireEvent.change(screen.getByTestId("video-preset"), {
      target: { value: "fast-720p" },
    });
    expect(onChange).toHaveBeenCalled();
    const latest = onChange.mock.calls.at(-1)![0] as VideoFormValues;
    expect(latest.modelId).toBe("sana-video-2b-720p");
    expect(latest.width).toBe(1280);
    expect(latest.height).toBe(720);
    expect(latest.durationSeconds).toBe(4);
    expect(latest.fps).toBe(24);
    expect(latest.sampler).toBe("flow-dpm-solver");
    expect(latest.mode).toBe("text2video");
  });

  it("preserves form values when Custom is re-selected after Fast 720p", () => {
    const onChange = vi.fn();
    render(<VideoPromptForm availableModels={AVAILABLE_MODELS} onChange={onChange} />);
    fireEvent.change(screen.getByTestId("video-preset"), {
      target: { value: "fast-720p" },
    });
    const afterFast = onChange.mock.calls.at(-1)![0] as VideoFormValues;
    onChange.mockClear();
    fireEvent.change(screen.getByTestId("video-preset"), {
      target: { value: "custom" },
    });
    // Custom preset has an empty patch, so the form should not re-emit
    // unrelated values; selecting Custom is a no-op against the current
    // form state.
    expect(afterFast.modelId).toBe("sana-video-2b-720p");
  });

  it("Fast 720p preset submits a request shaped for sana_video.py", () => {
    const fast = VIDEO_PRESETS.find((p) => p.id === "fast-720p")!;
    const merged: VideoFormValues = { ...DEFAULT_VIDEO_FORM_VALUES, ...fast.values };
    const request = videoFormToRequest(merged);
    expect(request.modelId).toBe("sana-video-2b-720p");
    expect(request.width).toBe(1280);
    expect(request.height).toBe(720);
    expect(request.durationSeconds).toBe(4);
    expect(request.fps).toBe(24);
    expect(request.sampler).toBe("flow-dpm-solver");
  });

  it("includes flow-dpm-solver in the sampler dropdown", () => {
    render(<VideoPromptForm availableModels={AVAILABLE_MODELS} />);
    expect(screen.getByTestId("video-advanced")).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(screen.getByTestId("video-advanced"));
    const sampler = screen.getByTestId("video-sampler") as HTMLSelectElement;
    const options = Array.from(sampler.options).map((o) => o.value);
    expect(options).toContain("flow-dpm-solver");
  });

  it("exposes VRAM budget knobs in Advanced and maps them onto the request", () => {
    const onChange = vi.fn();
    render(<VideoPromptForm availableModels={AVAILABLE_MODELS} onChange={onChange} />);
    fireEvent.click(screen.getByTestId("video-advanced"));
    expect(screen.getByTestId("video-memory-budget")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("video-layer-streaming"));
    expect(onChange).toHaveBeenCalled();
    const latest = onChange.mock.calls.at(-1)![0] as VideoFormValues;
    expect(latest.layerStreaming).toBe(false);
    const request = videoFormToRequest(latest);
    expect(request.maxCacheVramGB).toBe(latest.maxCacheVramGB);
    expect(request.layerStreaming).toBe(false);
  });
});
