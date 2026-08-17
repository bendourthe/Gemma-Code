/**
 * v1.15.0 Phase 6 (Issue 5) -- Video Lab chat redesign.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { VideoLabPage } from "../src/modules/video/VideoLabPage";
import { InMemoryVideoClient } from "../src/modules/video/videoClient";
import type { ListedModelDto } from "../src/pages/settings/modelsTypes";

const NO_MODELS = { list: async (): Promise<ListedModelDto[]> => [] };

function videoModels(): { list: () => Promise<ListedModelDto[]> } {
  return {
    list: async () => [
      {
        id: "ltx-video",
        displayName: "LTX-Video",
        type: "video",
        installed: true,
        source: "registry",
      },
    ],
  };
}

describe("VideoLabPage (chat)", () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  it("renders the model selector, empty state, composer, and Advanced panel", () => {
    render(
      <VideoLabPage client={new InMemoryVideoClient()} modelsClient={NO_MODELS} drainIntervalMs={20} />,
    );
    expect(screen.getByTestId("video-lab-page")).toBeInTheDocument();
    expect(screen.getByTestId("video-model-select")).toBeInTheDocument();
    expect(screen.getByTestId("video-empty")).toBeInTheDocument();
    expect(screen.getByTestId("media-composer")).toBeInTheDocument();
    expect(screen.getByTestId("video-advanced-settings")).toBeInTheDocument();
  });

  it("drops the mode select (intent is attachment-inferred)", () => {
    render(<VideoLabPage client={new InMemoryVideoClient()} modelsClient={NO_MODELS} />);
    expect(screen.queryByTestId("video-mode")).toBeNull();
  });

  it("a text-only prompt runs text2video and renders the clip inline", async () => {
    const client = new InMemoryVideoClient();
    render(
      <VideoLabPage
        client={client}
        modelsClient={videoModels()}
        drainIntervalMs={20}
        resolveMp4Url={(p) => `mock://${p}`}
      />,
    );
    client.scriptEvents("mem-video-1", [
      { kind: "progress", jobId: "mem-video-1", step: 2, totalSteps: 4 },
      { kind: "complete", jobId: "mem-video-1", mp4Path: "/tmp/clip.mp4" },
    ]);
    fireEvent.change(screen.getByTestId("media-composer-textarea"), { target: { value: "a fox" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("media-composer-submit"));
    });
    await act(async () => {
      vi.advanceTimersByTime(60);
      await Promise.resolve();
    });
    await waitFor(() => expect(client.lastRequest?.mode).toBe("text2video"));
    const media = await screen.findByTestId(/^message-media-/);
    expect(media.getAttribute("src")).toBe("mock:///tmp/clip.mp4");
    expect((client.lastRequest?.request as { prompt: string }).prompt).toBe("a fox");
    expect((client.lastRequest?.request as { modelId: string }).modelId).toBe("ltx-video");
  });

  it("an attached image routes to image2video with the source image", async () => {
    const client = new InMemoryVideoClient();
    render(
      <VideoLabPage client={client} modelsClient={videoModels()} drainIntervalMs={20} />,
    );
    client.scriptEvents("mem-video-1", [
      { kind: "complete", jobId: "mem-video-1", mp4Path: "/tmp/a.mp4" },
    ]);
    const file = new File(["x"], "cat.png", { type: "image/png" });
    await act(async () => {
      fireEvent.change(screen.getByTestId("media-composer-file"), { target: { files: [file] } });
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByTestId("media-composer-thumb-0")).toBeInTheDocument());
    fireEvent.change(screen.getByTestId("media-composer-textarea"), { target: { value: "pan slowly" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("media-composer-submit"));
    });
    await act(async () => {
      vi.advanceTimersByTime(40);
      await Promise.resolve();
    });
    await waitFor(() => expect(client.lastRequest?.mode).toBe("image2video"));
    expect((client.lastRequest?.request as { sourceImage: string }).sourceImage).toContain(
      "data:image/png",
    );
  });

  it("surfaces an error event in the assistant bubble", async () => {
    const client = new InMemoryVideoClient();
    render(<VideoLabPage client={client} modelsClient={videoModels()} drainIntervalMs={10} />);
    client.scriptEvents("mem-video-1", [
      { kind: "error", jobId: "mem-video-1", message: "VRAM exhausted" },
    ]);
    fireEvent.change(screen.getByTestId("media-composer-textarea"), { target: { value: "x" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("media-composer-submit"));
    });
    await act(async () => {
      vi.advanceTimersByTime(50);
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByText(/VRAM exhausted/)).toBeInTheDocument());
  });

  it("Copy Workflow forwards extracted JSON to the clipboard adapter", async () => {
    const client = new InMemoryVideoClient();
    client.extractResult = { mode: "text2video", prompt: "fox" };
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
    const { container } = render(
      <VideoLabPage
        client={client}
        modelsClient={videoModels()}
        drainIntervalMs={10}
        clipboard={clipboard}
        resolveMp4Url={(p) => `mock://${p}`}
      />,
    );
    client.scriptEvents("mem-video-1", [
      { kind: "complete", jobId: "mem-video-1", mp4Path: "/tmp/clip.mp4" },
    ]);
    fireEvent.change(screen.getByTestId("media-composer-textarea"), { target: { value: "fox" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("media-composer-submit"));
    });
    await act(async () => {
      vi.advanceTimersByTime(40);
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(container.querySelector('[data-testid^="video-copyworkflow-"]')).not.toBeNull(),
    );
    const btn = container.querySelector('[data-testid^="video-copyworkflow-"]') as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(btn);
      await Promise.resolve();
    });
    await waitFor(() => expect(clipboard.writeText).toHaveBeenCalled());
    expect(client.lastExtractInput).toBe("/tmp/clip.mp4");
  });

  it("the selector's 'Get more models' entry fires the callback", () => {
    const onGetMoreModels = vi.fn();
    render(
      <VideoLabPage
        client={new InMemoryVideoClient()}
        modelsClient={NO_MODELS}
        onGetMoreModels={onGetMoreModels}
      />,
    );
    fireEvent.change(screen.getByTestId("video-model-select"), {
      target: { value: "__get_more_models__" },
    });
    expect(onGetMoreModels).toHaveBeenCalled();
  });

  it("shows the shaping orb while a clip is pending", async () => {
    const client = new InMemoryVideoClient();
    render(
      <VideoLabPage client={client} modelsClient={videoModels()} drainIntervalMs={20} />,
    );
    fireEvent.change(screen.getByTestId("media-composer-textarea"), { target: { value: "a fox" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("media-composer-submit"));
    });
    const orb = await screen.findByRole("img", { name: /agent shaping/i });
    expect(orb).toHaveAttribute("data-agent-activity", "video-generation");
    expect(screen.queryByText("Generating...")).toBeNull();
    expect(screen.getByTestId("media-composer-beam")).toHaveAttribute("data-beam-mode", "traveling");
  });
});
