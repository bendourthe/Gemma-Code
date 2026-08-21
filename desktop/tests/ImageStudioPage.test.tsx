/**
 * v1.15.0 Phase 5 (Issue 5) -- Image Studio chat redesign.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { ImageStudioPage } from "../src/modules/image/ImageStudioPage";
import { InMemoryDiffusionClient } from "../src/modules/image/diffusionClient";
import { InMemoryGenerationQueueClient } from "../src/shared/studio/generationQueueClient";
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
    expect(screen.getByTestId("image-empty")).toBeInTheDocument();
    expect(screen.getByTestId("media-composer")).toBeInTheDocument();
    expect(screen.getByTestId("image-advanced-settings")).toBeInTheDocument();
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
    expect(screen.getByText("a fox")).toBeInTheDocument(); // echoed user bubble
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
    expect(screen.queryByText("Generating...")).toBeNull();
    expect(screen.getByTestId("media-composer-beam")).toHaveAttribute("data-beam-mode", "traveling");
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
    expect(screen.queryByText("Use Prompt")).toBeNull();
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
    const usePrompt = await screen.findByText("Use Prompt");
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
              installed: true,
              source: "registry",
            },
            {
              id: "sam2:hiera-tiny",
              displayName: "SAM2 Hiera Tiny",
              type: "image",
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
    expect(screen.getByTestId("image-sam-candidates")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByTestId("image-sam-candidate-car-a"));
    });
    await waitFor(() => expect(client.lastRequest?.mode).toBe("inpaint"));
    expect((client.lastRequest?.request as { mask: string }).mask).toBe("mask-a");
  });
});
