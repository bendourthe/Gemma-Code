/**
 * v1.15.0 Phase 6 (Issue 5) -- Video Lab chat redesign.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { VideoLabPage } from "../src/modules/video/VideoLabPage";
import { InMemoryVideoClient } from "../src/modules/video/videoClient";
import {
  InMemoryVideoEnhancementClient,
  type VideoEnhancementJobDto,
} from "../src/modules/video/videoEnhancementClient";
import { InMemoryStudioExplorerClient } from "../src/shared/explorer/studioExplorerClient";
import { InMemoryGenerationQueueClient } from "../src/shared/studio/generationQueueClient";
import type { ListedModelDto } from "../src/pages/settings/modelsTypes";
import { STUDIO_PENDING_CAPTIONS } from "../src/components/agentState/captionRotator";

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
        visualTokenBudget: { maxVideoFrames: 4 },
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
    expect(screen.getByTestId("composer-context-row").querySelector('[data-testid="video-model-select"]')).toBeTruthy();
    // v2.2.9 Phase 3.1 (T007): no header at all until it has visible children.
    expect(screen.getByTestId("video-lab-page").querySelector(":scope > header")).toBeNull();
    expect(screen.queryByTestId("context-usage-bar")).toBeNull();
    expect(screen.getByTestId("video-empty")).toBeInTheDocument();
    expect(screen.getByTestId("media-composer")).toBeInTheDocument();
    expect(screen.getByTestId("video-advanced-settings")).toBeInTheDocument();
    expect(screen.getByTestId("video-history-pane")).toBeInTheDocument();
  });

  // v2.2.9 Phase 3.1 (T007): with models installed the top bar would be empty
  // chrome, so it is not rendered (render-when-children, not a CSS height).
  // The Context bar still appears because the selected model publishes a
  // visual budget (Phase 3.2, T008) -- 0% before any generation.
  it("renders no header when models are installed and shows the visual Context bar", async () => {
    render(
      <VideoLabPage client={new InMemoryVideoClient()} modelsClient={videoModels()} drainIntervalMs={20} />,
    );
    await waitFor(() => expect(screen.getByTestId("context-usage-bar")).toBeInTheDocument());
    expect(screen.getByTestId("context-usage-bar")).toHaveAttribute(
      "aria-label",
      expect.stringContaining("visual token budget"),
    );
    expect(screen.getByTestId("context-usage-percent")).toHaveTextContent("0%");
    expect(screen.getByTestId("video-lab-page").querySelector(":scope > header")).toBeNull();
  });

  // v2.2.9 Phase 3.1 (T007): when no models are installed the get-more-models
  // CTA keeps the header alive, so the control never becomes unreachable.
  it("keeps the get-more-models CTA reachable when no models are installed", async () => {
    const onGetMoreModels = vi.fn();
    render(
      <VideoLabPage
        client={new InMemoryVideoClient()}
        modelsClient={NO_MODELS}
        drainIntervalMs={20}
        onGetMoreModels={onGetMoreModels}
      />,
    );
    await waitFor(() => expect(screen.getByTestId("video-get-more-models")).toBeInTheDocument());
    expect(screen.getByTestId("video-lab-page").querySelector(":scope > header")).not.toBeNull();
    fireEvent.click(screen.getByTestId("video-get-more-models"));
    expect(onGetMoreModels).toHaveBeenCalledTimes(1);
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
      {
        kind: "complete",
        jobId: "mem-video-1",
        outputPath: "/tmp/clip.mp4",
        outputId: "mem-video-1",
        outputHash: "a".repeat(64),
      },
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
    expect(screen.getByTestId("context-usage-bar")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /enhance video/i })).toBeInTheDocument();
    expect(screen.getAllByTestId(/^message-time-/).length).toBeGreaterThanOrEqual(2);
    // v2.2.9 Phase 1.3: these turns report no token usage, so the span is
    // omitted rather than rendered as an em dash.
    expect(screen.queryAllByTestId(/^message-tokens-/).length).toBe(0);
  });

  it("repairs an unavailable runtime and retries the same video turn exactly once", async () => {
    const client = new InMemoryVideoClient();
    const text2video = client.text2video.bind(client);
    const text2videoSpy = vi
      .spyOn(client, "text2video")
      .mockRejectedValueOnce(new Error("runtime-unavailable: CUDA runtime is not ready"))
      .mockImplementation(text2video);
    client.scriptEvents("mem-video-1", [
      {
        kind: "complete",
        jobId: "mem-video-1",
        outputPath: "/tmp/repaired.mp4",
        outputId: "mem-video-1",
        outputHash: "b".repeat(64),
      },
    ]);
    const mediaRuntimeClient = {
      status: vi.fn(async () => ({
        state: "repairable" as const,
        code: "RUNTIME_UNAVAILABLE",
        message: "The local media runtime needs repair.",
        retryable: true,
        progress: 0,
        logPath: "C:\\logs\\media-runtime-repair.log",
      })),
      repair: vi.fn(async () => ({
        state: "ready" as const,
        code: "READY",
        message: "The local media runtime is ready.",
        retryable: false,
        progress: 100,
        logPath: "C:\\logs\\media-runtime-repair.log",
      })),
      cancelRepair: vi.fn(),
      openLogLocation: vi.fn(async () => true),
    };

    render(
      <VideoLabPage
        client={client}
        modelsClient={videoModels()}
        mediaRuntimeClient={mediaRuntimeClient}
        drainIntervalMs={20}
        resolveMp4Url={(path) => `mock://${path}`}
      />,
    );
    fireEvent.change(screen.getByTestId("media-composer-textarea"), { target: { value: "a repaired clip" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("media-composer-submit"));
    });
    await waitFor(() => expect(screen.getByTestId("media-runtime-recovery")).toBeInTheDocument());
    await act(async () => {
      fireEvent.click(screen.getByTestId("media-runtime-repair"));
      await Promise.resolve();
      vi.advanceTimersByTime(60);
    });
    await waitFor(() => expect(screen.getByTestId(/^message-media-/)).toBeInTheDocument());
    expect(text2videoSpy).toHaveBeenCalledTimes(2);
    expect(mediaRuntimeClient.repair).toHaveBeenCalledTimes(1);
    const page = screen.getByTestId("video-lab-page");
    expect(page.querySelectorAll('[data-testid^="message-shell-vuser-"]')).toHaveLength(1);
    expect(page.querySelectorAll('[data-testid^="message-shell-vassistant-"]')).toHaveLength(1);
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
      { kind: "complete", jobId: "mem-video-1", outputPath: "/tmp/a.mp4" },
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
      { kind: "complete", jobId: "mem-video-1", outputPath: "/tmp/clip.mp4" },
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
    // v2.4.4 Phase 5.3: one of Creating / Crafting / Generating, never Shaping.
    expect(screen.queryByText("Shaping...")).toBeNull();
    expect(
      STUDIO_PENDING_CAPTIONS.some((caption) => screen.queryByText(caption) !== null),
    ).toBe(true);
    // The old assertion here was `queryByText("Generating...")` is null, which
    // meant "no separate status label besides the orb". "Generating..." is now
    // one of the orb's own captions, so the check moves to the composer: the
    // pending signal must still be the orb, not a second line of text.
    expect(screen.queryByTestId("video-lab-status-label")).toBeNull();
    expect(screen.getByTestId("media-composer-beam")).toHaveAttribute("data-beam-mode", "traveling");
  });

  it("turns a complete event without an output path into a written failure", async () => {
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

  it("does not expose Enhance for a playable completion without durable output identity", async () => {
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
      { kind: "complete", jobId: "mem-video-1", outputPath: "/tmp/clip.mp4" },
    ]);
    fireEvent.change(screen.getByTestId("media-composer-textarea"), {
      target: { value: "fox" },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("media-composer-submit"));
      vi.advanceTimersByTime(40);
      await Promise.resolve();
    });

    await waitFor(() => expect(screen.getByTestId(/^message-media-/)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /enhance video/i })).toBeNull();
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
      { kind: "complete", jobId: "mem-video-1", outputPath: "/tmp/clip.mp4" },
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
      { kind: "complete", jobId: "mem-video-1", outputPath: "/tmp/a.mp4" },
    ]);
    client.scriptEvents("mem-video-2", [
      { kind: "complete", jobId: "mem-video-2", outputPath: "/tmp/b.mp4" },
    ]);
    client.scriptEvents("mem-video-3", [
      { kind: "complete", jobId: "mem-video-3", outputPath: "/tmp/c.mp4" },
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
      { kind: "complete", jobId: "mem-video-1", outputPath: "/tmp/avatar.mp4" },
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
      { kind: "complete", jobId: "mem-video-1", outputPath: "/tmp/clip.mp4" },
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
      { kind: "complete", jobId: "mem-video-2", outputPath: "/tmp/clip2.mp4" },
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

  it("persists turns and continues from the last clip on a follow-up with no attachment", async () => {
    const client = new InMemoryVideoClient();
    const explorer = new InMemoryStudioExplorerClient("video");
    render(
      <VideoLabPage
        client={client}
        modelsClient={videoModels()}
        explorerClient={explorer}
        drainIntervalMs={20}
        resolveMp4Url={(p) => `mock://${p}`}
      />,
    );
    client.scriptEvents("mem-video-1", [
      { kind: "complete", jobId: "mem-video-1", outputPath: "/tmp/clip.mp4" },
    ]);
    fireEvent.change(screen.getByTestId("media-composer-textarea"), { target: { value: "a fox" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("media-composer-submit"));
    });
    await act(async () => {
      vi.advanceTimersByTime(60);
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByTestId(/^message-media-/)).toBeInTheDocument());
    await waitFor(() => {
      const session = explorer.listTree().sessions[0];
      expect(session).toBeTruthy();
      expect(explorer.listTurns(session!.id)).toHaveLength(2);
      expect(session!.lastOutputRef).toBe("/tmp/clip.mp4");
    });
    client.scriptEvents("mem-video-2", [
      { kind: "complete", jobId: "mem-video-2", outputPath: "/tmp/clip-snow.mp4" },
    ]);
    fireEvent.change(screen.getByTestId("media-composer-textarea"), { target: { value: "make it snow" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("media-composer-submit"));
    });
    await act(async () => {
      vi.advanceTimersByTime(60);
      await Promise.resolve();
    });
    await waitFor(() => expect(client.lastRequest?.mode).toBe("text2video"));
    expect((client.lastRequest?.request as { continueFrom?: { priorJobId: string } }).continueFrom).toMatchObject({
      priorJobId: "mem-video-1",
      lastFramePath: "/tmp/clip.mp4",
    });
    await waitFor(() => {
      const session = explorer.listTree().sessions[0];
      expect(explorer.listTurns(session!.id).length).toBeGreaterThanOrEqual(3);
    });
  });

  it("hydrates transcript after remount from the same explorer", async () => {
    const explorer = new InMemoryStudioExplorerClient("video");
    const session = explorer.createSession({
      folderId: null,
      title: "Fox",
      modelId: "wan2.1-t2v-1.3b",
    });
    explorer.appendTurn({ sessionId: session.id, role: "user", content: "a fox" });
    explorer.appendTurn({
      sessionId: session.id,
      role: "assistant",
      content: "",
      mediaRef: "/tmp/clip.mp4",
    });
    const { unmount } = render(
      <VideoLabPage
        client={new InMemoryVideoClient()}
        modelsClient={videoModels()}
        explorerClient={explorer}
        initialSessionId={session.id}
      />,
    );
    await waitFor(() => expect(screen.getByText("a fox")).toBeInTheDocument());
    const media = screen.getByTestId(/^message-media-/);
    expect(media.tagName.toLowerCase()).toBe("video");
    expect(media).toHaveAttribute("src", "/tmp/clip.mp4");
    unmount();
    render(
      <VideoLabPage
        client={new InMemoryVideoClient()}
        modelsClient={videoModels()}
        explorerClient={explorer}
        initialSessionId={session.id}
      />,
    );
    await waitFor(() => expect(screen.getByText("a fox")).toBeInTheDocument());
    expect(screen.getByTestId(/^message-media-/)).toHaveAttribute("src", "/tmp/clip.mp4");
    expect(screen.queryByRole("button", { name: /enhance video/i })).toBeNull();
  });

  it("hydrate of a missing file is an error, not an empty complete", async () => {
    const explorer = new InMemoryStudioExplorerClient("video");
    const session = explorer.createSession({
      folderId: null,
      title: "Gone",
      modelId: "wan2.1-t2v-1.3b",
    });
    explorer.appendTurn({ sessionId: session.id, role: "user", content: "a fox" });
    explorer.appendTurn({
      sessionId: session.id,
      role: "assistant",
      content: "",
      mediaRef: "/tmp/gone.mp4",
    });
    render(
      <VideoLabPage
        client={new InMemoryVideoClient()}
        modelsClient={videoModels()}
        explorerClient={explorer}
        initialSessionId={session.id}
        outputExists={() => false}
      />,
    );
    await waitFor(() => expect(screen.getByText(/output missing on disk/i)).toBeInTheDocument());
    expect(screen.queryByTestId(/^message-media-/)).toBeNull();
  });

  it("opens Enhance for an eligible clip and keeps original and enhanced downloads distinct", async () => {
    const client = new InMemoryVideoClient();
    const enhancement = new InMemoryVideoEnhancementClient();
    render(
      <VideoLabPage
        client={client}
        enhancementClient={enhancement}
        modelsClient={videoModels()}
        drainIntervalMs={20}
        enhancementPollIntervalMs={20}
        resolveMp4Url={(path) => `mock://${path}`}
      />,
    );
    client.scriptEvents("mem-video-1", [
      {
        kind: "complete",
        jobId: "mem-video-1",
        outputPath: "/tmp/clip.mp4",
        outputId: "mem-video-1",
        outputHash: "a".repeat(64),
      },
    ]);
    fireEvent.change(screen.getByTestId("media-composer-textarea"), {
      target: { value: "a fox" },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("media-composer-submit"));
    });
    await act(async () => {
      vi.advanceTimersByTime(60);
      await Promise.resolve();
    });
    const enhance = await screen.findByRole("button", { name: /enhance video/i });
    expect(enhance).toHaveAccessibleName(/enhance video/i);
    fireEvent.click(enhance);
    await waitFor(() =>
      expect(screen.getByTestId("video-enhancement-start")).toBeEnabled(),
    );
    fireEvent.click(screen.getByTestId("video-enhancement-start"));
    await waitFor(() => expect(enhancement.enqueued).toHaveLength(1));
    expect(enhancement.enqueued[0]).toMatchObject({
      parentJobId: "mem-video-1",
      sourceOutputId: "mem-video-1",
      mode: "upscale",
      upscalePreset: "animation-upscale-2x",
    });
    const queued = enhancement.jobs[0];
    expect(queued).toBeTruthy();
    enhancement.setJob(succeedEnhancement(queued!));
    await act(async () => {
      vi.advanceTimersByTime(40);
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(screen.getByText(/Enhanced output \(1708 x 960/)).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: /download original video/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /download enhanced video/i })).toBeInTheDocument();
    expect(
      screen.queryByTestId(`video-enhance-video-enhancement-${queued!.childJobId}`),
    ).toBeNull();
    const seen: string[] = [];
    const originalClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function click() {
      seen.push(this.download);
    };
    try {
      fireEvent.click(screen.getByRole("button", { name: /download original video/i }));
      fireEvent.click(screen.getByRole("button", { name: /download enhanced video/i }));
    } finally {
      HTMLAnchorElement.prototype.click = originalClick;
    }
    expect(seen[0]).toMatch(/^nexus-video-original-/);
    expect(seen[1]).toMatch(/^nexus-video-enhanced-/);
    expect(screen.getAllByTestId(/^message-media-/)[0]).toHaveAttribute(
      "src",
      "mock:///tmp/clip.mp4",
    );
    expect(screen.getAllByTestId(/^message-media-/)[1]).toHaveAttribute(
      "src",
      "mock:///tmp/enhanced.mp4",
    );
    fireEvent.click(screen.getAllByTestId(/^message-media-/)[1]!);
    await waitFor(() =>
      expect(
        screen.getByTestId(`video-copyworkflow-video-enhancement-${queued!.childJobId}`),
      ).toHaveAccessibleName("Copy workflow and provenance"),
    );
  });

  it("still publishes a successful enhancement after the panel is closed", async () => {
    const client = new InMemoryVideoClient();
    const enhancement = new InMemoryVideoEnhancementClient();
    render(
      <VideoLabPage
        client={client}
        enhancementClient={enhancement}
        modelsClient={videoModels()}
        drainIntervalMs={20}
        enhancementPollIntervalMs={20}
        resolveMp4Url={(path) => `mock://${path}`}
      />,
    );
    client.scriptEvents("mem-video-1", [
      {
        kind: "complete",
        jobId: "mem-video-1",
        outputPath: "/tmp/clip.mp4",
        outputId: "mem-video-1",
        outputHash: "a".repeat(64),
      },
    ]);
    fireEvent.change(screen.getByTestId("media-composer-textarea"), {
      target: { value: "a fox" },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("media-composer-submit"));
    });
    await act(async () => {
      vi.advanceTimersByTime(60);
      await Promise.resolve();
    });
    fireEvent.click(screen.getByRole("button", { name: /enhance video/i }));
    await waitFor(() =>
      expect(screen.getByTestId("video-enhancement-start")).toBeEnabled(),
    );
    fireEvent.click(screen.getByTestId("video-enhancement-start"));
    await waitFor(() => expect(enhancement.jobs).toHaveLength(1));
    fireEvent.click(screen.getByTestId("video-enhancement-close"));
    expect(screen.queryByTestId("video-enhancement-panel")).toBeNull();
    enhancement.setJob(succeedEnhancement(enhancement.jobs[0]!));
    await act(async () => {
      vi.advanceTimersByTime(40);
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(screen.getByText(/separate synthesized file/i)).toBeInTheDocument(),
    );
  });

  it("shows enhancement children in the generation queue bar", async () => {
    const queue = new InMemoryGenerationQueueClient();
    queue.jobs = [
      {
        id: "enhance-child",
        pillar: "video",
        jobType: "video_enhancement",
        parameters: {},
        batchSpec: null,
        parentId: "mem-video-1",
        enhancement: null,
        sortOrder: 0,
        state: "running",
        priority: "interactive",
        threadId: null,
        error: null,
        createdAt: "2026-08-28T12:00:00.000Z",
        updatedAt: "2026-08-28T12:00:00.000Z",
      },
    ];
    render(
      <VideoLabPage
        client={new InMemoryVideoClient()}
        modelsClient={videoModels()}
        queueClient={queue}
        drainIntervalMs={20}
      />,
    );
    fireEvent.click(screen.getByTestId("video-advanced-settings"));
    await act(async () => {
      vi.advanceTimersByTime(40);
      await Promise.resolve();
    });
    const item = await screen.findByTestId("generation-queue-item-enhance-child");
    expect(item).toHaveAttribute("data-job-kind", "enhancement");
    expect(item).toHaveTextContent("Enhance enhance-child");
    expect(screen.getByRole("button", { name: "Cancel enhancement enhance-child" })).toBeInTheDocument();
  });

  it("persists an empty complete as error text, not an empty assistant turn", async () => {
    const client = new InMemoryVideoClient();
    const explorer = new InMemoryStudioExplorerClient("video");
    render(
      <VideoLabPage
        client={client}
        modelsClient={videoModels()}
        explorerClient={explorer}
        drainIntervalMs={20}
      />,
    );
    client.scriptEvents("mem-video-1", [{ kind: "complete", jobId: "mem-video-1" }]);
    fireEvent.change(screen.getByTestId("media-composer-textarea"), { target: { value: "a fox in grass" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("media-composer-submit"));
      vi.advanceTimersByTime(40);
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByText(/playable clip/i)).toBeInTheDocument());
    await waitFor(() => {
      const session = explorer.listTree().sessions[0];
      expect(session).toBeTruthy();
      const assistant = explorer.listTurns(session!.id).find((t) => t.role === "assistant");
      expect(assistant?.content).toMatch(/playable clip/i);
      expect(assistant?.mediaRef).toBeFalsy();
    });
  });

  it("maps a missing-weights error to Settings > Models", async () => {
    const client = new InMemoryVideoClient();
    render(<VideoLabPage client={client} modelsClient={videoModels()} drainIntervalMs={20} />);
    client.scriptEvents("mem-video-1", [
      {
        kind: "error",
        jobId: "mem-video-1",
        message: "SANA-Video 2B 720p weights are not installed",
      },
    ]);
    fireEvent.change(screen.getByTestId("media-composer-textarea"), { target: { value: "a puppy in grass" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("media-composer-submit"));
      vi.advanceTimersByTime(40);
      await Promise.resolve();
    });
    expect(await screen.findByText(/Settings > Models/i)).toBeInTheDocument();
    expect(screen.queryByTestId(/^message-media-/)).toBeNull();
  });

  it("fails closed when complete has a path the player cannot resolve", async () => {
    const client = new InMemoryVideoClient();
    render(
      <VideoLabPage
        client={client}
        modelsClient={videoModels()}
        drainIntervalMs={20}
        resolveMp4Url={() => ""}
      />,
    );
    client.scriptEvents("mem-video-1", [
      { kind: "complete", jobId: "mem-video-1", outputPath: "/tmp/clip.mp4" },
    ]);
    fireEvent.change(screen.getByTestId("media-composer-textarea"), { target: { value: "fox" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("media-composer-submit"));
      vi.advanceTimersByTime(40);
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByText(/playable clip/i)).toBeInTheDocument());
    expect(screen.queryByTestId(/^message-media-/)).toBeNull();
  });
});

function succeedEnhancement(job: VideoEnhancementJobDto): VideoEnhancementJobDto {
  return {
    ...job,
    state: "succeeded",
    finishedAt: "2026-08-28T12:00:04.000Z",
    output: {
      outputId: `${job.childJobId}:output`,
      path: "/tmp/enhanced.mp4",
      contentHash: "b".repeat(64),
      sizeBytes: 2_048,
      durationSeconds: 4,
      width: 1_708,
      height: 960,
      frameRate: { numerator: 24, denominator: 1 },
      provenanceRecordId: "prov-1",
      preProvenanceContainerSha256: "b".repeat(64),
      publishedContainerSha256: "b".repeat(64),
      workflow: { enhancement: { backend: "video2x" } },
      durableProvenance: { sourceJobId: job.parentJobId },
    },
  };
}
