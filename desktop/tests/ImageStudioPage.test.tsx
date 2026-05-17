import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { ImageStudioPage } from "../src/modules/image/ImageStudioPage";
import {
  InMemoryDiffusionClient,
  type ProgressEvent,
} from "../src/modules/image/diffusionClient";

function script(client: InMemoryDiffusionClient, jobId: string, events: ProgressEvent[]) {
  client.scriptEvents(jobId, events);
}

describe("ImageStudioPage", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders all four mode tabs", () => {
    const client = new InMemoryDiffusionClient();
    render(<ImageStudioPage client={client} drainIntervalMs={50} />);
    expect(screen.getByTestId("mode-tab-txt2img")).toBeInTheDocument();
    expect(screen.getByTestId("mode-tab-img2img")).toBeInTheDocument();
    expect(screen.getByTestId("mode-tab-inpaint")).toBeInTheDocument();
    expect(screen.getByTestId("mode-tab-outpaint")).toBeInTheDocument();
  });

  it("switches modes and renders the right center pane", () => {
    const client = new InMemoryDiffusionClient();
    render(<ImageStudioPage client={client} drainIntervalMs={50} />);
    expect(screen.getByTestId("image-canvas-preview")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("mode-tab-img2img"));
    expect(screen.getByTestId("image-source-zone")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("mode-tab-inpaint"));
    expect(screen.getByTestId("image-inpaint-zone")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("mode-tab-outpaint"));
    expect(screen.getByTestId("image-outpaint-controls")).toBeInTheDocument();
  });

  it("runs an end-to-end txt2img fake job, updates progress, and lands the output in the gallery", async () => {
    const client = new InMemoryDiffusionClient();
    render(<ImageStudioPage client={client} drainIntervalMs={20} />);
    fireEvent.change(screen.getByTestId("image-prompt"), { target: { value: "a fox" } });
    script(client, "mem-job-1", [
      { kind: "progress", jobId: "mem-job-1", step: 2, totalSteps: 4, preview: "AAA=" },
      { kind: "complete", jobId: "mem-job-1", png: "PNGB64==" },
    ]);
    await act(async () => {
      fireEvent.click(screen.getByTestId("image-generate"));
    });
    await act(async () => {
      vi.advanceTimersByTime(60);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.getByTestId("gallery-item-mem-job-1")).toBeInTheDocument();
    });
    expect(client.lastRequest?.mode).toBe("txt2img");
  });

  it("surfaces error events to the UI", async () => {
    const client = new InMemoryDiffusionClient();
    render(<ImageStudioPage client={client} drainIntervalMs={10} />);
    fireEvent.change(screen.getByTestId("image-prompt"), { target: { value: "x" } });
    script(client, "mem-job-1", [
      { kind: "error", jobId: "mem-job-1", message: "GPU on fire" },
    ]);
    await act(async () => {
      fireEvent.click(screen.getByTestId("image-generate"));
    });
    await act(async () => {
      vi.advanceTimersByTime(50);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.getByTestId("image-error")).toHaveTextContent(/GPU on fire/);
    });
  });

  it("Copy Workflow invokes extractWorkflow and forwards JSON to the clipboard adapter", async () => {
    const client = new InMemoryDiffusionClient();
    client.extractResult = { mode: "txt2img", prompt: "fox" };
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
    render(
      <ImageStudioPage
        client={client}
        drainIntervalMs={10}
        clipboard={clipboard}
      />,
    );
    fireEvent.change(screen.getByTestId("image-prompt"), { target: { value: "fox" } });
    script(client, "mem-job-1", [
      { kind: "complete", jobId: "mem-job-1", png: "PNGB64==" },
    ]);
    await act(async () => {
      fireEvent.click(screen.getByTestId("image-generate"));
    });
    await act(async () => {
      vi.advanceTimersByTime(30);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.getByTestId("gallery-item-mem-job-1")).toBeInTheDocument();
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("gallery-copy-mem-job-1"));
      await Promise.resolve();
    });
    await waitFor(() => expect(clipboard.writeText).toHaveBeenCalled());
  });

  it("blocks img2img generation without a source image", async () => {
    const client = new InMemoryDiffusionClient();
    render(<ImageStudioPage client={client} drainIntervalMs={50} initialMode="img2img" />);
    fireEvent.change(screen.getByTestId("image-prompt"), { target: { value: "fox" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("image-generate"));
    });
    await waitFor(() => {
      expect(screen.getByTestId("image-error")).toHaveTextContent(/Source image required/);
    });
  });
});
