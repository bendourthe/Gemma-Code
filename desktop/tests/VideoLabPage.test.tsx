import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { VideoLabPage } from "../src/modules/video/VideoLabPage";
import {
  InMemoryVideoClient,
  type VideoProgressEvent,
} from "../src/modules/video/videoClient";

function script(
  client: InMemoryVideoClient,
  jobId: string,
  events: VideoProgressEvent[],
) {
  client.scriptEvents(jobId, events);
}

describe("VideoLabPage", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders form, thumbnail strip, and gallery placeholders by default", () => {
    const client = new InMemoryVideoClient();
    render(<VideoLabPage client={client} drainIntervalMs={50} />);
    expect(screen.getByTestId("video-lab-page")).toBeInTheDocument();
    expect(screen.getByTestId("video-prompt-form")).toBeInTheDocument();
    expect(screen.getByTestId("video-thumbnail-strip")).toBeInTheDocument();
    expect(screen.getByTestId("video-thumbnail-empty")).toBeInTheDocument();
    expect(screen.getByTestId("video-gallery-empty")).toBeInTheDocument();
  });

  it("switching mode to image2video reveals the source upload zone", () => {
    const client = new InMemoryVideoClient();
    render(<VideoLabPage client={client} drainIntervalMs={50} />);
    expect(screen.queryByTestId("video-source-zone")).not.toBeInTheDocument();
    fireEvent.change(screen.getByTestId("video-mode"), {
      target: { value: "image2video" },
    });
    expect(screen.getByTestId("video-source-zone")).toBeInTheDocument();
  });

  it("blocks generate when prompt is empty and surfaces the error", async () => {
    const client = new InMemoryVideoClient();
    render(<VideoLabPage client={client} drainIntervalMs={20} />);
    await act(async () => {
      fireEvent.click(screen.getByTestId("video-generate"));
    });
    expect(screen.getByTestId("video-error")).toHaveTextContent(/Prompt is required/);
  });

  it("blocks image2video generation until a source image is uploaded", async () => {
    const client = new InMemoryVideoClient();
    render(<VideoLabPage client={client} drainIntervalMs={20} />);
    fireEvent.change(screen.getByTestId("video-mode"), {
      target: { value: "image2video" },
    });
    fireEvent.change(screen.getByTestId("video-prompt"), {
      target: { value: "fox" },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("video-generate"));
    });
    expect(screen.getByTestId("video-error")).toHaveTextContent(/Source image required/);
  });

  it("renders a thumbnail strip cell for each generated second", async () => {
    const client = new InMemoryVideoClient();
    render(
      <VideoLabPage
        client={client}
        drainIntervalMs={10}
        initialValues={{ durationSeconds: 3 }}
      />,
    );
    fireEvent.change(screen.getByTestId("video-prompt"), {
      target: { value: "a fox" },
    });
    script(client, "mem-video-1", [
      {
        kind: "progress",
        jobId: "mem-video-1",
        step: 1,
        totalSteps: 30,
        preview: "AAA=",
        secondIndex: 0,
      },
      {
        kind: "progress",
        jobId: "mem-video-1",
        step: 15,
        totalSteps: 30,
        preview: "BBB=",
        secondIndex: 1,
      },
      {
        kind: "progress",
        jobId: "mem-video-1",
        step: 30,
        totalSteps: 30,
        preview: "CCC=",
        secondIndex: 2,
      },
      { kind: "complete", jobId: "mem-video-1", mp4Path: "/tmp/x.mp4" },
    ]);
    await act(async () => {
      fireEvent.click(screen.getByTestId("video-generate"));
    });
    await act(async () => {
      vi.advanceTimersByTime(40);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.getByTestId("video-thumbnail-0")).toBeInTheDocument();
      expect(screen.getByTestId("video-thumbnail-2")).toBeInTheDocument();
    });
  });

  it("runs an end-to-end text2video job, updates progress, and lands the output in the gallery", async () => {
    const client = new InMemoryVideoClient();
    render(
      <VideoLabPage
        client={client}
        drainIntervalMs={20}
        resolveMp4Url={(path) => `mock://${path}`}
      />,
    );
    fireEvent.change(screen.getByTestId("video-prompt"), {
      target: { value: "a fox" },
    });
    script(client, "mem-video-1", [
      { kind: "progress", jobId: "mem-video-1", step: 2, totalSteps: 4 },
      { kind: "complete", jobId: "mem-video-1", mp4Path: "/tmp/clip.mp4" },
    ]);
    await act(async () => {
      fireEvent.click(screen.getByTestId("video-generate"));
    });
    await act(async () => {
      vi.advanceTimersByTime(60);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.getByTestId("video-gallery-item-mem-video-1")).toBeInTheDocument();
    });
    expect(client.lastRequest?.mode).toBe("text2video");
  });

  it("surfaces error events to the UI", async () => {
    const client = new InMemoryVideoClient();
    render(<VideoLabPage client={client} drainIntervalMs={10} />);
    fireEvent.change(screen.getByTestId("video-prompt"), { target: { value: "x" } });
    script(client, "mem-video-1", [
      { kind: "error", jobId: "mem-video-1", message: "VRAM exhausted" },
    ]);
    await act(async () => {
      fireEvent.click(screen.getByTestId("video-generate"));
    });
    await act(async () => {
      vi.advanceTimersByTime(50);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.getByTestId("video-error")).toHaveTextContent(/VRAM exhausted/);
    });
  });

  it("Copy Workflow invokes extractWorkflow and forwards JSON to the clipboard adapter", async () => {
    const client = new InMemoryVideoClient();
    client.extractResult = { kind: "video", mode: "text2video", prompt: "fox" };
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
    render(
      <VideoLabPage
        client={client}
        drainIntervalMs={10}
        clipboard={clipboard}
        resolveMp4Url={(path) => `mock://${path}`}
      />,
    );
    fireEvent.change(screen.getByTestId("video-prompt"), {
      target: { value: "fox" },
    });
    script(client, "mem-video-1", [
      { kind: "complete", jobId: "mem-video-1", mp4Path: "/tmp/clip.mp4" },
    ]);
    await act(async () => {
      fireEvent.click(screen.getByTestId("video-generate"));
    });
    await act(async () => {
      vi.advanceTimersByTime(40);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(
        screen.getByTestId("video-gallery-copy-workflow-mem-video-1"),
      ).toBeInTheDocument();
    });
    await act(async () => {
      fireEvent.click(
        screen.getByTestId("video-gallery-copy-workflow-mem-video-1"),
      );
    });
    await waitFor(() => {
      expect(clipboard.writeText).toHaveBeenCalled();
    });
    expect(clipboard.writeText.mock.calls[0]![0]).toContain('"mode": "text2video"');
  });

  it("Copy Workflow surfaces an error when the MP4 has no workflow", async () => {
    const client = new InMemoryVideoClient();
    client.extractResult = null;
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
    render(
      <VideoLabPage
        client={client}
        drainIntervalMs={10}
        clipboard={clipboard}
        resolveMp4Url={(path) => `mock://${path}`}
      />,
    );
    fireEvent.change(screen.getByTestId("video-prompt"), {
      target: { value: "fox" },
    });
    script(client, "mem-video-1", [
      { kind: "complete", jobId: "mem-video-1", mp4Path: "/tmp/clip.mp4" },
    ]);
    await act(async () => {
      fireEvent.click(screen.getByTestId("video-generate"));
    });
    await act(async () => {
      vi.advanceTimersByTime(40);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(
        screen.getByTestId("video-gallery-copy-workflow-mem-video-1"),
      ).toBeInTheDocument();
    });
    await act(async () => {
      fireEvent.click(
        screen.getByTestId("video-gallery-copy-workflow-mem-video-1"),
      );
    });
    await waitFor(() => {
      expect(screen.getByTestId("video-error")).toHaveTextContent(
        /Workflow metadata not found/,
      );
    });
  });

  it("Cancel stops the polling loop and clears the job", async () => {
    const client = new InMemoryVideoClient();
    render(<VideoLabPage client={client} drainIntervalMs={10} />);
    fireEvent.change(screen.getByTestId("video-prompt"), {
      target: { value: "fox" },
    });
    script(client, "mem-video-1", []);
    await act(async () => {
      fireEvent.click(screen.getByTestId("video-generate"));
    });
    await act(async () => {
      vi.advanceTimersByTime(20);
      await Promise.resolve();
    });
    expect(screen.queryByTestId("video-cancel")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByTestId("video-cancel"));
    });
    expect(screen.queryByTestId("video-cancel")).not.toBeInTheDocument();
  });

  it("model dropdown filters by mode", () => {
    const client = new InMemoryVideoClient();
    render(<VideoLabPage client={client} drainIntervalMs={10} />);
    const modelSelect = screen.getByTestId("video-model") as HTMLSelectElement;
    const text2videoModels = Array.from(modelSelect.options).map((o) => o.value);
    expect(text2videoModels).toContain("ltx-video");
    expect(text2videoModels).not.toContain("svd");
    fireEvent.change(screen.getByTestId("video-mode"), {
      target: { value: "image2video" },
    });
    const imageModelSelect = screen.getByTestId("video-model") as HTMLSelectElement;
    const i2vModels = Array.from(imageModelSelect.options).map((o) => o.value);
    expect(i2vModels).toContain("svd");
  });
});
