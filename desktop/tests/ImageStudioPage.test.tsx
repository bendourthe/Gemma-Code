/**
 * v1.15.0 Phase 5 (Issue 5) -- Image Studio chat redesign.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { ImageStudioPage } from "../src/modules/image/ImageStudioPage";
import { InMemoryDiffusionClient } from "../src/modules/image/diffusionClient";
import { InMemoryGenerationQueueClient } from "../src/shared/studio/generationQueueClient";
import { InMemoryStudioExplorerClient } from "../src/shared/explorer/studioExplorerClient";
import type { ListedModelDto } from "../src/pages/settings/modelsTypes";

const NO_MODELS = { list: async (): Promise<ListedModelDto[]> => [] };

function imageModels(): { list: () => Promise<ListedModelDto[]> } {
  return {
    list: async () => [
      {
        id: "sana-1.6b-1024",
        displayName: "SANA 1.5 1.6B",
        type: "image",
        installed: true,
        source: "registry",
        vramGB: 3.2,
        visualTokenBudget: { maxImages: 4 },
      },
    ],
  };
}

describe("ImageStudioPage (chat)", () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  it("renders the model selector, empty state, composer, and Advanced panel", () => {
    render(
      <ImageStudioPage client={new InMemoryDiffusionClient()} modelsClient={NO_MODELS} drainIntervalMs={20} />,
    );
    expect(screen.getByTestId("image-model-select")).toBeInTheDocument();
    expect(screen.getByTestId("composer-context-row").querySelector('[data-testid="image-model-select"]')).toBeTruthy();
    // v2.2.9 Phase 3.1 (T007): no header at all until it has visible children.
    expect(screen.getByTestId("image-studio-page").querySelector(":scope > header")).toBeNull();
    expect(screen.queryByTestId("context-usage-bar")).toBeNull();
    expect(screen.getByTestId("image-empty")).toBeInTheDocument();
    expect(screen.getByTestId("media-composer")).toBeInTheDocument();
    expect(screen.getByTestId("image-advanced-settings")).toBeInTheDocument();
    expect(screen.getByTestId("image-history-pane")).toBeInTheDocument();
  });

  // v2.2.9 Phase 3.1 (T007): with models installed the top bar would be empty
  // chrome, so it is not rendered (render-when-children, not a CSS height).
  // The Context bar still appears because the selected model publishes a
  // visual budget (Phase 3.2, T008) -- 0% before any generation.
  it("renders no header when models are installed and shows the visual Context bar", async () => {
    render(
      <ImageStudioPage client={new InMemoryDiffusionClient()} modelsClient={imageModels()} drainIntervalMs={20} />,
    );
    await waitFor(() => expect(screen.getByTestId("context-usage-bar")).toBeInTheDocument());
    expect(screen.getByTestId("context-usage-bar")).toHaveAttribute(
      "aria-label",
      expect.stringContaining("visual token budget"),
    );
    expect(screen.getByTestId("context-usage-percent")).toHaveTextContent("0%");
    expect(screen.getByTestId("image-studio-page").querySelector(":scope > header")).toBeNull();
  });

  // v2.2.9 Phase 3.1 (T007): when no models are installed the get-more-models
  // CTA keeps the header alive, so the control never becomes unreachable.
  it("keeps the get-more-models CTA reachable when no models are installed", async () => {
    const onGetMoreModels = vi.fn();
    render(
      <ImageStudioPage
        client={new InMemoryDiffusionClient()}
        modelsClient={NO_MODELS}
        drainIntervalMs={20}
        onGetMoreModels={onGetMoreModels}
      />,
    );
    await waitFor(() => expect(screen.getByTestId("image-get-more-models")).toBeInTheDocument());
    expect(screen.getByTestId("image-studio-page").querySelector(":scope > header")).not.toBeNull();
    fireEvent.click(screen.getByTestId("image-get-more-models"));
    expect(onGetMoreModels).toHaveBeenCalledTimes(1);
  });

  it("drops the four mode tabs", () => {
    render(<ImageStudioPage client={new InMemoryDiffusionClient()} modelsClient={NO_MODELS} />);
    expect(screen.queryByTestId("mode-tab-txt2img")).toBeNull();
    expect(screen.queryByTestId("mode-tab-inpaint")).toBeNull();
  });

  it("a text-only prompt runs txt2img and renders the generated image inline", async () => {
    const client = new InMemoryDiffusionClient();
    render(<ImageStudioPage client={client} modelsClient={imageModels()} drainIntervalMs={20} />);
    client.scriptEvents("mem-job-1", [
      { kind: "progress", jobId: "mem-job-1", step: 2, totalSteps: 4 },
      { kind: "complete", jobId: "mem-job-1", png: "PNGB64==" },
    ]);
    fireEvent.change(screen.getByTestId("media-composer-textarea"), { target: { value: "a fox" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("media-composer-submit"));
    });
    await act(async () => {
      vi.advanceTimersByTime(60);
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByAltText("Generated image")).toBeInTheDocument());
    expect(client.lastRequest?.mode).toBe("txt2img");
    expect((client.lastRequest?.request as { prompt: string }).prompt).toBe("a fox");
    expect((client.lastRequest?.request as { modelId: string }).modelId).toBe("sana-1.6b-1024");
    expect(screen.getByTestId("context-usage-bar")).toBeInTheDocument();
    expect(screen.getAllByTestId(/^message-time-/).length).toBeGreaterThanOrEqual(2);
    // v2.2.9 Phase 1.3: these turns report no token usage, so the span is
    // omitted rather than rendered as an em dash.
    expect(screen.queryAllByTestId(/^message-tokens-/).length).toBe(0);
    // User bubble plus the auto-created session title both read the prompt.
    expect(screen.getAllByText("a fox").length).toBeGreaterThanOrEqual(1);
  });

  it("repairs an unavailable runtime and retries the same image turn exactly once", async () => {
    const client = new InMemoryDiffusionClient();
    const txt2img = client.txt2img.bind(client);
    const txt2imgSpy = vi
      .spyOn(client, "txt2img")
      .mockRejectedValueOnce(new Error("runtime-unavailable: CUDA runtime is not ready"))
      .mockImplementation(txt2img);
    client.scriptEvents("mem-job-1", [{ kind: "complete", jobId: "mem-job-1", png: "PNGB64==" }]);
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
      <ImageStudioPage
        client={client}
        modelsClient={imageModels()}
        mediaRuntimeClient={mediaRuntimeClient}
        drainIntervalMs={20}
      />,
    );
    fireEvent.change(screen.getByTestId("media-composer-textarea"), { target: { value: "a repaired fox" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("media-composer-submit"));
    });
    await waitFor(() => expect(screen.getByTestId("media-runtime-recovery")).toBeInTheDocument());
    await act(async () => {
      fireEvent.click(screen.getByTestId("media-runtime-repair"));
      await Promise.resolve();
      vi.advanceTimersByTime(60);
    });
    await waitFor(() => expect(screen.getByAltText("Generated image")).toBeInTheDocument());
    expect(txt2imgSpy).toHaveBeenCalledTimes(2);
    expect(mediaRuntimeClient.repair).toHaveBeenCalledTimes(1);
    const page = screen.getByTestId("image-studio-page");
    expect(page.querySelectorAll('[data-testid^="message-shell-user-"]')).toHaveLength(1);
    expect(page.querySelectorAll('[data-testid^="message-shell-assistant-"]')).toHaveLength(1);
  });

  it("does not generate until a conflicting active model switch is approved", async () => {
    const client = new InMemoryDiffusionClient();
    render(
      <ImageStudioPage
        client={client}
        modelsClient={imageModels()}
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
    await waitFor(() => expect(client.lastRequest?.mode).toBe("txt2img"));
    expect(screen.queryByTestId("model-switch-dialog")).toBeNull();
  });

  it("an attached image routes to img2img with the source image", async () => {
    const client = new InMemoryDiffusionClient();
    render(<ImageStudioPage client={client} modelsClient={imageModels()} drainIntervalMs={20} />);
    client.scriptEvents("mem-job-1", [{ kind: "complete", jobId: "mem-job-1", png: "P==" }]);
    const file = new File(["x"], "cat.png", { type: "image/png" });
    await act(async () => {
      fireEvent.change(screen.getByTestId("media-composer-file"), { target: { files: [file] } });
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByTestId("media-composer-thumb-0")).toBeInTheDocument());
    fireEvent.change(screen.getByTestId("media-composer-textarea"), { target: { value: "make it night" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("media-composer-submit"));
    });
    await act(async () => {
      vi.advanceTimersByTime(40);
      await Promise.resolve();
    });
    await waitFor(() => expect(client.lastRequest?.mode).toBe("img2img"));
    expect((client.lastRequest?.request as { sourceImage: string }).sourceImage).toContain(
      "data:image/png",
    );
  });

  it("Copy Workflow forwards extracted JSON to the clipboard adapter", async () => {
    const client = new InMemoryDiffusionClient();
    client.extractResult = { prompt: "fox" };
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
    const { container } = render(
      <ImageStudioPage
        client={client}
        modelsClient={imageModels()}
        drainIntervalMs={20}
        clipboard={clipboard}
      />,
    );
    client.scriptEvents("mem-job-1", [{ kind: "complete", jobId: "mem-job-1", png: "PNG==" }]);
    fireEvent.change(screen.getByTestId("media-composer-textarea"), { target: { value: "fox" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("media-composer-submit"));
    });
    await act(async () => {
      vi.advanceTimersByTime(40);
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByAltText("Generated image")).toBeInTheDocument());
    fireEvent.click(screen.getByAltText("Generated image"));
    const copyBtn = container.querySelector('[data-testid^="image-copyworkflow-"]') as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(copyBtn);
      await Promise.resolve();
    });
    await waitFor(() => expect(clipboard.writeText).toHaveBeenCalled());
  });

  it("the selector's 'Get more models' entry fires the callback", () => {
    const onGetMoreModels = vi.fn();
    render(
      <ImageStudioPage
        client={new InMemoryDiffusionClient()}
        modelsClient={NO_MODELS}
        onGetMoreModels={onGetMoreModels}
      />,
    );
    fireEvent.change(screen.getByTestId("image-model-select"), {
      target: { value: "__get_more_models__" },
    });
    expect(onGetMoreModels).toHaveBeenCalled();
  });

  it("shows the shaping orb while a generation is pending", async () => {
    const client = new InMemoryDiffusionClient();
    render(<ImageStudioPage client={client} modelsClient={imageModels()} drainIntervalMs={20} />);
    fireEvent.change(screen.getByTestId("media-composer-textarea"), { target: { value: "a fox" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("media-composer-submit"));
    });
    const orb = await screen.findByRole("img", { name: /agent shaping/i });
    expect(orb).toHaveAttribute("data-agent-activity", "image-generation");
    expect(orb).toHaveAttribute("data-orb-size", "hero");
    expect(screen.getByText("Shaping...")).toBeInTheDocument();
    expect(screen.queryByText("Generating...")).toBeNull();
    expect(screen.getByTestId("media-composer-beam")).toHaveAttribute("data-beam-mode", "traveling");
  });

  it("turns a complete event without image bytes into a written failure", async () => {
    const client = new InMemoryDiffusionClient();
    render(<ImageStudioPage client={client} modelsClient={imageModels()} drainIntervalMs={20} />);
    client.scriptEvents("mem-job-1", [{ kind: "complete", jobId: "mem-job-1", png: "" }]);
    fireEvent.change(screen.getByTestId("media-composer-textarea"), { target: { value: "fox" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("media-composer-submit"));
      vi.advanceTimersByTime(40);
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByText(/Generation failed/)).toBeInTheDocument());
    expect(screen.queryByTestId(/^image-download-/)).toBeNull();
    expect(screen.queryByTestId(/^message-media-/)).toBeNull();
  });

  it("hides generated-image actions when the browser cannot decode the asset", async () => {
    const client = new InMemoryDiffusionClient();
    render(<ImageStudioPage client={client} modelsClient={imageModels()} drainIntervalMs={20} />);
    client.scriptEvents("mem-job-1", [{ kind: "complete", jobId: "mem-job-1", png: "bad" }]);
    fireEvent.change(screen.getByTestId("media-composer-textarea"), { target: { value: "fox" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("media-composer-submit"));
      vi.advanceTimersByTime(40);
      await Promise.resolve();
    });
    const media = await screen.findByTestId(/^message-media-/);
    fireEvent.error(media);
    await waitFor(() => expect(screen.queryByTestId(/^image-download-/)).toBeNull());
    expect(screen.getByText(/could not be displayed/)).toBeInTheDocument();
  });

  it("hides recall actions when extract returns no workflow", async () => {
    const client = new InMemoryDiffusionClient();
    client.extractResult = null;
    render(<ImageStudioPage client={client} modelsClient={imageModels()} drainIntervalMs={20} />);
    client.scriptEvents("mem-job-1", [{ kind: "complete", jobId: "mem-job-1", png: "PNG==" }]);
    fireEvent.change(screen.getByTestId("media-composer-textarea"), { target: { value: "fox" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("media-composer-submit"));
    });
    await act(async () => {
      vi.advanceTimersByTime(40);
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByAltText("Generated image")).toBeInTheDocument());
    // v2.2.3 Phase 2 (2.3): recall actions are icon buttons named by aria-label.
    expect(screen.queryByLabelText("Use Prompt")).toBeNull();
  });

  it("Use Prompt prefills the advanced prompt from extracted workflow", async () => {
    const client = new InMemoryDiffusionClient();
    client.extractResult = { prompt: "watercolor fox", seed: 42 };
    render(<ImageStudioPage client={client} modelsClient={imageModels()} drainIntervalMs={20} />);
    client.scriptEvents("mem-job-1", [{ kind: "complete", jobId: "mem-job-1", png: "PNG==" }]);
    fireEvent.change(screen.getByTestId("media-composer-textarea"), { target: { value: "fox" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("media-composer-submit"));
    });
    await act(async () => {
      vi.advanceTimersByTime(40);
      await Promise.resolve();
    });
    fireEvent.click(await screen.findByAltText("Generated image"));
    const usePrompt = await screen.findByLabelText("Use Prompt");
    fireEvent.click(screen.getByTestId("image-advanced-settings"));
    await act(async () => {
      fireEvent.click(usePrompt);
    });
    await waitFor(() => {
      expect((screen.getByTestId("image-prompt") as HTMLTextAreaElement | HTMLInputElement).value).toBe(
        "watercolor fox",
      );
    });
  });

  it("shows queue pending count for a seed sweep", async () => {
    const queue = new InMemoryGenerationQueueClient();
    render(
      <ImageStudioPage
        client={new InMemoryDiffusionClient()}
        modelsClient={imageModels()}
        drainIntervalMs={20}
        queueClient={queue}
      />,
    );
    fireEvent.click(screen.getByTestId("image-advanced-settings"));
    await act(async () => {
      fireEvent.click(screen.getByTestId("image-seed-sweep"));
    });
    await waitFor(() => expect(screen.getByTestId("generation-queue-count")).toHaveTextContent("1"));
  });

  it("omits SAM2 utility weights from the generator picker", async () => {
    render(
      <ImageStudioPage
        client={new InMemoryDiffusionClient()}
        modelsClient={{
          list: async () => [
            {
              id: "sana-1.6b-1024",
              displayName: "SANA 1.5 1.6B",
              type: "image",
              task: "image",
              installed: true,
              source: "registry",
            },
            {
              id: "sam2:hiera-tiny",
              displayName: "SAM2 Hiera Tiny",
              type: "image",
              task: "image",
              installed: true,
              source: "registry",
              tags: ["sam2", "utility"],
            },
          ],
        }}
      />,
    );
    await waitFor(() => {
      const select = screen.getByTestId("image-model-select") as HTMLSelectElement;
      const values = [...select.options].map((o) => o.value);
      expect(values).toContain("sana-1.6b-1024");
      expect(values).not.toContain("sam2:hiera-tiny");
    });
  });

  it("replace the car with a truck segments then inpaints", async () => {
    const client = new InMemoryDiffusionClient();
    render(<ImageStudioPage client={client} modelsClient={imageModels()} drainIntervalMs={20} />);
    client.scriptEvents("mem-job-1", [{ kind: "complete", jobId: "mem-job-1", png: "P==" }]);
    const file = new File(["x"], "scene.png", { type: "image/png" });
    await act(async () => {
      fireEvent.change(screen.getByTestId("media-composer-file"), { target: { files: [file] } });
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByTestId("media-composer-thumb-0")).toBeInTheDocument());
    fireEvent.change(screen.getByTestId("media-composer-textarea"), {
      target: { value: "replace the car with a truck" },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("media-composer-submit"));
    });
    await waitFor(() => expect(client.lastRequest?.mode).toBe("inpaint"));
    expect(client.lastSegment?.phrase).toBe("car");
    expect((client.lastRequest?.request as { prompt: string }).prompt).toMatch(/Replace the car with truck/i);
  });

  it("weights_missing leaves the original image and asks to install or paint a mask", async () => {
    const client = new InMemoryDiffusionClient();
    client.segmentResult = {
      ok: false,
      code: "weights_missing",
      message: "SAM2 weights are not installed. Install sam2:hiera-tiny from Settings > Models, or paint a mask to continue.",
    };
    render(<ImageStudioPage client={client} modelsClient={imageModels()} drainIntervalMs={20} />);
    const file = new File(["x"], "scene.png", { type: "image/png" });
    await act(async () => {
      fireEvent.change(screen.getByTestId("media-composer-file"), { target: { files: [file] } });
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByTestId("media-composer-thumb-0")).toBeInTheDocument());
    fireEvent.change(screen.getByTestId("media-composer-textarea"), {
      target: { value: "replace the car with a truck" },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("media-composer-submit"));
    });
    expect(await screen.findByText(/Install sam2:hiera-tiny/i)).toBeInTheDocument();
    expect(client.lastRequest).toBeNull();
    expect(screen.getByAltText("Attachment")).toBeInTheDocument();
  });

  it("does not inpaint when segmentation returns multiple candidates until one is tapped", async () => {
    const client = new InMemoryDiffusionClient();
    client.segmentResult = {
      ok: true,
      candidates: [
        { id: "c0", maskPngBase64: "mask-a", score: 0.9, label: "car-a" },
        { id: "c1", maskPngBase64: "mask-b", score: 0.8, label: "car-b" },
      ],
    };
    client.scriptEvents("mem-job-1", [{ kind: "complete", jobId: "mem-job-1", png: "P==" }]);
    render(<ImageStudioPage client={client} modelsClient={imageModels()} drainIntervalMs={20} />);
    const file = new File(["x"], "scene.png", { type: "image/png" });
    await act(async () => {
      fireEvent.change(screen.getByTestId("media-composer-file"), { target: { files: [file] } });
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByTestId("media-composer-thumb-0")).toBeInTheDocument());
    fireEvent.change(screen.getByTestId("media-composer-textarea"), {
      target: { value: "replace the cars with trucks" },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("media-composer-submit"));
    });
    expect(await screen.findByText(/Several matches/i)).toBeInTheDocument();
    expect(client.lastRequest).toBeNull();
    expect(await screen.findByTestId("image-sam-candidates")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByTestId("image-sam-candidate-car-a"));
    });
    await waitFor(() => expect(client.lastRequest?.mode).toBe("inpaint"));
    expect((client.lastRequest?.request as { mask: string }).mask).toBe("mask-a");
  });

  it("turns a complete event with whitespace-only png into a written failure", async () => {
    const client = new InMemoryDiffusionClient();
    render(<ImageStudioPage client={client} modelsClient={imageModels()} drainIntervalMs={20} />);
    client.scriptEvents("mem-job-1", [{ kind: "complete", jobId: "mem-job-1", png: "   " }]);
    fireEvent.change(screen.getByTestId("media-composer-textarea"), { target: { value: "fox" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("media-composer-submit"));
      vi.advanceTimersByTime(40);
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByText(/Generation failed/)).toBeInTheDocument());
    expect(screen.queryByTestId(/^image-download-/)).toBeNull();
    expect(screen.queryByTestId(/^message-media-/)).toBeNull();
  });

  it("lists an injected image session in the history pane", () => {
    const explorer = new InMemoryStudioExplorerClient("image");
    explorer.createSession({
      folderId: null,
      title: "Fox portrait",
      modelId: "sana-1.6b-1024",
    });
    render(
      <ImageStudioPage
        client={new InMemoryDiffusionClient()}
        modelsClient={imageModels()}
        explorerClient={explorer}
      />,
    );
    expect(screen.getByTestId("image-history-pane")).toBeInTheDocument();
    expect(screen.getByText("Fox portrait")).toBeInTheDocument();
  });

  it("persists turns and uses last PNG path for a follow-up with no attachment", async () => {
    const client = new InMemoryDiffusionClient();
    const explorer = new InMemoryStudioExplorerClient("image");
    render(
      <ImageStudioPage
        client={client}
        modelsClient={imageModels()}
        explorerClient={explorer}
        drainIntervalMs={20}
      />,
    );
    client.scriptEvents("mem-job-1", [
      { kind: "complete", jobId: "mem-job-1", png: "PNGB64==", outputPath: "/tmp/fox.png" },
    ]);
    fireEvent.change(screen.getByTestId("media-composer-textarea"), { target: { value: "a fox" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("media-composer-submit"));
    });
    await act(async () => {
      vi.advanceTimersByTime(60);
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByAltText("Generated image")).toBeInTheDocument());
    await waitFor(() => {
      const session = explorer.listTree().sessions[0];
      expect(session).toBeTruthy();
      expect(explorer.listTurns(session!.id)).toHaveLength(2);
      expect(session!.lastOutputRef).toBe("/tmp/fox.png");
    });
    client.scriptEvents("mem-job-2", [
      { kind: "complete", jobId: "mem-job-2", png: "PNGB64==", outputPath: "/tmp/fox-snow.png" },
    ]);
    fireEvent.change(screen.getByTestId("media-composer-textarea"), { target: { value: "make it snow" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("media-composer-submit"));
    });
    await act(async () => {
      vi.advanceTimersByTime(60);
      await Promise.resolve();
    });
    await waitFor(() => expect(client.lastRequest?.mode).toBe("img2img"));
    expect((client.lastRequest?.request as { sourceImage: string }).sourceImage).toBe("/tmp/fox.png");
    await waitFor(() => {
      const session = explorer.listTree().sessions[0];
      expect(explorer.listTurns(session!.id).length).toBeGreaterThanOrEqual(3);
    });
  });

  it("hydrates transcript after remount from the same explorer", async () => {
    const explorer = new InMemoryStudioExplorerClient("image");
    const session = explorer.createSession({
      folderId: null,
      title: "Fox",
      modelId: "sana-1.6b-1024",
    });
    explorer.appendTurn({ sessionId: session.id, role: "user", content: "a fox" });
    explorer.appendTurn({
      sessionId: session.id,
      role: "assistant",
      content: "",
      mediaRef: "/tmp/fox.png",
    });
    const { unmount } = render(
      <ImageStudioPage
        client={new InMemoryDiffusionClient()}
        modelsClient={imageModels()}
        explorerClient={explorer}
        initialSessionId={session.id}
      />,
    );
    await waitFor(() => expect(screen.getByText("a fox")).toBeInTheDocument());
    expect(screen.getByRole("img")).toHaveAttribute("src", "/tmp/fox.png");
    unmount();
    render(
      <ImageStudioPage
        client={new InMemoryDiffusionClient()}
        modelsClient={imageModels()}
        explorerClient={explorer}
        initialSessionId={session.id}
      />,
    );
    await waitFor(() => expect(screen.getByText("a fox")).toBeInTheDocument());
    expect(screen.getByRole("img")).toHaveAttribute("src", "/tmp/fox.png");
  });

  it("hydrate of a missing file is an error, not an empty complete", async () => {
    const explorer = new InMemoryStudioExplorerClient("image");
    const session = explorer.createSession({
      folderId: null,
      title: "Gone",
      modelId: "sana-1.6b-1024",
    });
    explorer.appendTurn({ sessionId: session.id, role: "user", content: "a fox" });
    explorer.appendTurn({
      sessionId: session.id,
      role: "assistant",
      content: "",
      mediaRef: "/tmp/gone.png",
    });
    render(
      <ImageStudioPage
        client={new InMemoryDiffusionClient()}
        modelsClient={imageModels()}
        explorerClient={explorer}
        initialSessionId={session.id}
        outputExists={() => false}
      />,
    );
    await waitFor(() => expect(screen.getByText(/output missing on disk/i)).toBeInTheDocument());
    expect(screen.queryByRole("img")).toBeNull();
  });
});
