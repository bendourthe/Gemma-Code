/**
 * v1.15.0 Phase 6 (Issue 5) -- Video Lab chat redesign.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { VideoLabPage } from "../src/modules/video/VideoLabPage";
import { InMemoryVideoClient } from "../src/modules/video/videoClient";
import { InMemoryStudioExplorerClient } from "../src/shared/explorer/studioExplorerClient";
import type { ListedModelDto } from "../src/pages/settings/modelsTypes";

const NO_MODELS = { list: async (): Promise<ListedModelDto[]> => [] };

function videoModels(): { list: () => Promise<ListedModelDto[]> } {
  return {
    list: async () => [
      {
        id: "wan2.1-t2v-1.3b",
        displayName: "Wan 2.1 T2V 1.3B",
        type: "video",
        installed: true,
        source: "registry",
        vramGB: 5.5,
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
    expect(screen.getByTestId("video-history-pane")).toBeInTheDocument();
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
    expect((client.lastRequest?.request as { modelId: string }).modelId).toBe("wan2.1-t2v-1.3b");
  });

  it("does not generate until a conflicting active model switch is approved", async () => {
    const client = new InMemoryVideoClient();
    render(
      <VideoLabPage
        client={client}
        modelsClient={videoModels()}
        hostVramFreeGB={1}
        activeSchedulerJob={{
          id: "coding-job",
          moduleId: "coding",
          jobType: "agent-turn",
          modelId: "qwen2.5-coder:14b",
          estimatedVramGB: 9,
          startedAt: 1,
        }}
      />,
    );
    fireEvent.change(screen.getByTestId("media-composer-textarea"), {
      target: { value: "a fox" },
    });
    fireEvent.click(screen.getByTestId("media-composer-submit"));
    expect(await screen.findByTestId("model-switch-dialog")).toBeInTheDocument();
    expect(client.lastRequest).toBeNull();
    fireEvent.click(screen.getByTestId("model-switch-dialog-switch"));
    await waitFor(() => expect(client.lastRequest?.mode).toBe("text2video"));
    expect(screen.queryByTestId("model-switch-dialog")).toBeNull();
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
    await waitFor(() => expect(screen.getByTestId(/^message-media-/)).toBeInTheDocument());
    fireEvent.click(screen.getByTestId(/^message-media-/));
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
    expect(orb).toHaveAttribute("data-orb-size", "hero");
    expect(screen.getByText("Shaping...")).toBeInTheDocument();
    expect(screen.queryByText("Generating...")).toBeNull();
    expect(screen.getByTestId("media-composer-beam")).toHaveAttribute("data-beam-mode", "traveling");
  });

  it("turns a complete event without an mp4 path into a written failure", async () => {
    const client = new InMemoryVideoClient();
    render(<VideoLabPage client={client} modelsClient={videoModels()} drainIntervalMs={20} />);
    client.scriptEvents("mem-video-1", [{ kind: "complete", jobId: "mem-video-1" }]);
    fireEvent.change(screen.getByTestId("media-composer-textarea"), { target: { value: "fox" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("media-composer-submit"));
      vi.advanceTimersByTime(40);
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByText(/Generation failed/)).toBeInTheDocument());
    expect(screen.queryByTestId(/^video-actions-/)).toBeNull();
    expect(screen.queryByTestId(/^message-media-/)).toBeNull();
  });

  it("hides generated-video actions when the browser cannot decode the asset", async () => {
    const client = new InMemoryVideoClient();
    render(
      <VideoLabPage
        client={client}
        modelsClient={videoModels()}
        drainIntervalMs={20}
        resolveMp4Url={(path) => `mock://${path}`}
      />,
    );
    client.scriptEvents("mem-video-1", [
      { kind: "complete", jobId: "mem-video-1", mp4Path: "/tmp/clip.mp4" },
    ]);
    fireEvent.change(screen.getByTestId("media-composer-textarea"), { target: { value: "fox" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("media-composer-submit"));
      vi.advanceTimersByTime(40);
      await Promise.resolve();
    });
    const media = await screen.findByTestId(/^message-media-/);
    fireEvent.error(media);
    await waitFor(() => expect(screen.queryByTestId(/^video-actions-/)).toBeNull());
    expect(screen.getByText(/could not be displayed/)).toBeInTheDocument();
  });

  it("chains continuation segments when duration exceeds the tier clip", async () => {
    const client = new InMemoryVideoClient();
    render(
      <VideoLabPage
        client={client}
        modelsClient={videoModels()}
        drainIntervalMs={10}
        initialValues={{ durationSeconds: 12, clipSeconds: 4 }}
      />,
    );
    client.scriptEvents("mem-video-1", [
      { kind: "complete", jobId: "mem-video-1", mp4Path: "/tmp/a.mp4" },
    ]);
    client.scriptEvents("mem-video-2", [
      { kind: "complete", jobId: "mem-video-2", mp4Path: "/tmp/b.mp4" },
    ]);
    client.scriptEvents("mem-video-3", [
      { kind: "complete", jobId: "mem-video-3", mp4Path: "/tmp/c.mp4" },
    ]);
    fireEvent.change(screen.getByTestId("media-composer-textarea"), { target: { value: "long take" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("media-composer-submit"));
    });
    await act(async () => {
      vi.advanceTimersByTime(80);
      await Promise.resolve();
    });
    await waitFor(() => expect(client.requests.length).toBe(3));
    expect(client.requests[0]?.request.durationSeconds).toBe(4);
    expect(client.requests[1]?.request.continueFrom).toMatchObject({
      priorJobId: "mem-video-1",
      segmentIndex: 1,
    });
  });

  it("blocks avatar mode below diffusion-pro", async () => {
    const client = new InMemoryVideoClient();
    render(
      <VideoLabPage
        client={client}
        modelsClient={videoModels()}
        drainIntervalMs={10}
        diffusionTier="diffusion-mid"
        vramGB={12}
      />,
    );
    expect(screen.queryByTestId("video-avatar-confirm")).toBeNull();
  });

  it("runs audio2video on a confirmed diffusion-pro host", async () => {
    const client = new InMemoryVideoClient();
    render(
      <VideoLabPage
        client={client}
        modelsClient={videoModels()}
        drainIntervalMs={10}
        diffusionTier="diffusion-pro"
        vramGB={24}
      />,
    );
    fireEvent.click(screen.getByText("Advanced settings"));
    fireEvent.click(screen.getByTestId("video-avatar-confirm"));
    const png = new File(["x"], "face.png", { type: "image/png" });
    const wav = new File(["y"], "line.wav", { type: "audio/wav" });
    await act(async () => {
      fireEvent.change(screen.getByTestId("media-composer-file"), {
        target: { files: [png, wav] },
      });
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByTestId("media-composer-thumb-1")).toBeInTheDocument());
    fireEvent.change(screen.getByTestId("media-composer-textarea"), { target: { value: "hello" } });
    client.scriptEvents("mem-video-1", [
      { kind: "complete", jobId: "mem-video-1", mp4Path: "/tmp/avatar.mp4" },
    ]);
    await act(async () => {
      fireEvent.click(screen.getByTestId("media-composer-submit"));
    });
    await act(async () => {
      vi.advanceTimersByTime(40);
      await Promise.resolve();
    });
    await waitFor(() => expect(client.lastRequest?.mode).toBe("audio2video"));
    expect(
      (client.lastRequest?.request as { confirmLocalAvatar?: boolean }).confirmLocalAvatar,
    ).toBe(true);
  });

  it("timeline comments round-trip into the next generation prompt", async () => {
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
    const add = await screen.findByTestId(/-add-comment$/);
    await act(async () => {
      fireEvent.click(add);
    });
    client.scriptEvents("mem-video-2", [
      { kind: "complete", jobId: "mem-video-2", mp4Path: "/tmp/clip2.mp4" },
    ]);
    fireEvent.change(screen.getByTestId("media-composer-textarea"), { target: { value: "again" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("media-composer-submit"));
    });
    await waitFor(() =>
      expect((client.lastRequest?.request as { prompt: string }).prompt).toMatch(/Frame notes:/),
    );
  });

  it("lists an injected video session in the history pane", () => {
    const explorer = new InMemoryStudioExplorerClient("video");
    explorer.createSession({
      folderId: null,
      title: "Fox clip",
      modelId: "wan2.1-t2v-1.3b",
    });
    render(
      <VideoLabPage
        client={new InMemoryVideoClient()}
        modelsClient={videoModels()}
        explorerClient={explorer}
      />,
    );
    expect(screen.getByTestId("video-history-pane")).toBeInTheDocument();
    expect(screen.getByText("Fox clip")).toBeInTheDocument();
  });
});
