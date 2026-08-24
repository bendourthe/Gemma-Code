import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { MediaComposer } from "../src/shared/chat/MediaComposer";
import type { MicRecorder } from "../src/shared/chat/micRecorder";

function pngFile(): File {
  return new File(["x"], "a.png", { type: "image/png" });
}

function wavFile(): File {
  return new File(["x"], "a.wav", { type: "audio/wav" });
}

describe("MediaComposer multimodal gating", () => {
  it("disables the vision affordance and drops non-OCR image types when imageEnabled is false", async () => {
    render(
      <MediaComposer
        onSubmit={vi.fn()}
        imageEnabled={false}
        imageDisabledReason="This model cannot see images."
        accept="image/*,audio/*,application/pdf"
      />,
    );
    const add = screen.getByTestId("media-composer-add");
    expect(add).toHaveAttribute("data-image-enabled", "false");
    expect(add).toHaveAttribute("title", "This model cannot see images.");
    fireEvent.change(screen.getByTestId("media-composer-file"), {
      target: { files: [new File(["x"], "a.gif", { type: "image/gif" })] },
    });
    await waitFor(() => expect(screen.queryByTestId("media-composer-thumb-0")).toBeNull());
  });

  it("still accepts a PNG for RapidOCR when imageEnabled is false", async () => {
    render(
      <MediaComposer
        onSubmit={vi.fn()}
        imageEnabled={false}
        accept="image/png,image/jpeg,application/pdf"
      />,
    );
    fireEvent.change(screen.getByTestId("media-composer-file"), { target: { files: [pngFile()] } });
    await waitFor(() => expect(screen.getByTestId("media-composer-thumb-0")).toBeInTheDocument());
  });

  it("accepts audio when audioEnabled and shows a recording indicator while the mic is open", async () => {
    let started = false;
    const mic: MicRecorder = {
      async start() {
        started = true;
      },
      async stop() {
        started = false;
        return "data:audio/webm;base64,AAA";
      },
    };
    const onSubmit = vi.fn();
    render(
      <MediaComposer
        onSubmit={onSubmit}
        audioEnabled
        audioHint="Transcribe locally"
        accept="audio/*"
        micRecorder={mic}
      />,
    );
    fireEvent.click(screen.getByTestId("media-composer-mic"));
    await waitFor(() => expect(screen.getByTestId("media-composer-recording")).toBeInTheDocument());
    expect(started).toBe(true);
    fireEvent.click(screen.getByTestId("media-composer-mic"));
    await waitFor(() => expect(screen.getByTestId("media-composer-thumb-0")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("media-composer-submit"));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const [, atts] = onSubmit.mock.calls[0] as [string, string[]];
    expect(atts[0]).toContain("data:audio/webm");
  });

  it("still accepts an image when imageEnabled is true (studio default)", async () => {
    render(<MediaComposer onSubmit={vi.fn()} />);
    fireEvent.change(screen.getByTestId("media-composer-file"), { target: { files: [pngFile()] } });
    await waitFor(() => expect(screen.getByTestId("media-composer-thumb-0")).toBeInTheDocument());
    expect(screen.queryByTestId("media-composer-mic")).toBeNull();
  });

  it("does not attach audio when audioEnabled is false", async () => {
    render(<MediaComposer onSubmit={vi.fn()} accept="audio/*,image/*" />);
    fireEvent.change(screen.getByTestId("media-composer-file"), { target: { files: [wavFile()] } });
    await waitFor(() => expect(screen.queryByTestId("media-composer-thumb-0")).toBeNull());
  });
});
