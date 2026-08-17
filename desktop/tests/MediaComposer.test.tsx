/**
 * v1.15.0 Phase 5 (Issue 5) -- attachment-capable chat composer.
 */

import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { MediaComposer } from "../src/shared/chat/MediaComposer";

afterEach(() => cleanup());

function pngFile(name = "a.png"): File {
  return new File(["x"], name, { type: "image/png" });
}

describe("MediaComposer", () => {
  it("submits typed text with no attachments", () => {
    const onSubmit = vi.fn();
    render(<MediaComposer onSubmit={onSubmit} />);
    fireEvent.change(screen.getByTestId("media-composer-textarea"), { target: { value: "hello" } });
    fireEvent.click(screen.getByTestId("media-composer-submit"));
    expect(onSubmit).toHaveBeenCalledWith("hello", []);
  });

  it("is disabled while empty and enabled once an image is attached", async () => {
    const onSubmit = vi.fn();
    render(<MediaComposer onSubmit={onSubmit} />);
    expect(screen.getByTestId("media-composer-submit")).toBeDisabled();
    fireEvent.change(screen.getByTestId("media-composer-file"), { target: { files: [pngFile()] } });
    await waitFor(() => expect(screen.getByTestId("media-composer-thumb-0")).toBeInTheDocument());
    expect(screen.getByTestId("media-composer-submit")).not.toBeDisabled();
    fireEvent.click(screen.getByTestId("media-composer-submit"));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const [text, atts] = onSubmit.mock.calls[0] as [string, string[]];
    expect(text).toBe("");
    expect(atts).toHaveLength(1);
    expect(atts[0]).toContain("data:image/png");
  });

  it("removes a pending attachment", async () => {
    render(<MediaComposer onSubmit={vi.fn()} />);
    fireEvent.change(screen.getByTestId("media-composer-file"), { target: { files: [pngFile()] } });
    await waitFor(() => expect(screen.getByTestId("media-composer-thumb-0")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("media-composer-remove-0"));
    await waitFor(() => expect(screen.queryByTestId("media-composer-thumb-0")).toBeNull());
  });

  it("Enter submits; Shift+Enter inserts a newline", () => {
    const onSubmit = vi.fn();
    render(<MediaComposer onSubmit={onSubmit} />);
    const ta = screen.getByTestId("media-composer-textarea");
    fireEvent.change(ta, { target: { value: "hi" } });
    fireEvent.keyDown(ta, { key: "Enter", shiftKey: true });
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.keyDown(ta, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledWith("hi", []);
  });

  it("plays a breathing beam on focus and a traveling beam while streaming", () => {
    const { rerender } = render(<MediaComposer onSubmit={vi.fn()} />);
    const beam = screen.getByTestId("media-composer-beam");
    expect(beam).toHaveAttribute("data-beam-playing", "false");
    fireEvent.focus(screen.getByTestId("media-composer-textarea"));
    expect(beam).toHaveAttribute("data-beam-playing", "true");
    expect(beam).toHaveAttribute("data-beam-mode", "breathing");
    rerender(<MediaComposer onSubmit={vi.fn()} streaming submitAccentVar="--accent-chatbot" />);
    expect(screen.getByTestId("media-composer-beam")).toHaveAttribute("data-beam-mode", "traveling");
    expect(screen.getByTestId("media-composer-beam")).toHaveAttribute("data-beam-accent", "--accent-chatbot");
  });
});
