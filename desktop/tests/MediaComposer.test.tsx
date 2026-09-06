/**
 * v1.15.0 Phase 5 (Issue 5) -- attachment-capable chat composer.
 */

import { afterEach, describe, it, expect, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import { MediaComposer } from "../src/shared/chat/MediaComposer";

afterEach(() => cleanup());

function pngFile(name = "a.png"): File {
  return new File(["x"], name, { type: "image/png" });
}

describe("MediaComposer", () => {
  it("submits typed text with no attachments", () => {
    const onSubmit = vi.fn();
    render(<MediaComposer onSubmit={onSubmit} />);
    fireEvent.change(screen.getByTestId("media-composer-textarea"), {
      target: { value: "hello" },
    });
    fireEvent.click(screen.getByTestId("media-composer-submit"));
    expect(onSubmit).toHaveBeenCalledWith("hello", []);
  });

  it("is disabled while empty and enabled once an image is attached", async () => {
    const onSubmit = vi.fn();
    render(<MediaComposer onSubmit={onSubmit} />);
    expect(screen.getByTestId("media-composer-submit")).toBeDisabled();
    fireEvent.change(screen.getByTestId("media-composer-file"), {
      target: { files: [pngFile()] },
    });
    await waitFor(() =>
      expect(screen.getByTestId("media-composer-thumb-0")).toBeInTheDocument(),
    );
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
    fireEvent.change(screen.getByTestId("media-composer-file"), {
      target: { files: [pngFile()] },
    });
    await waitFor(() =>
      expect(screen.getByTestId("media-composer-thumb-0")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId("media-composer-remove-0"));
    await waitFor(() =>
      expect(screen.queryByTestId("media-composer-thumb-0")).toBeNull(),
    );
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

  it("on focus plays the surface beam; streaming plays a traveling beam", () => {
    const { rerender } = render(<MediaComposer onSubmit={vi.fn()} />);
    const beam = screen.getByTestId("media-composer-beam");
    expect(beam).toHaveAttribute("data-beam-playing", "false");
    fireEvent.focus(screen.getByTestId("media-composer-textarea"));
    expect(beam).toHaveAttribute("data-beam-playing", "true");
    expect(screen.queryByTestId("media-composer-submit-metal")).toBeNull();
    // v2.2.3 Phase 2 (2.2): a pillar submitAccentVar must NOT tint the beam --
    // the beam is always the brand cyan.
    rerender(
      <MediaComposer
        onSubmit={vi.fn()}
        streaming
        submitAccentVar="--accent-image"
      />,
    );
    expect(screen.getByTestId("media-composer-beam")).toHaveAttribute(
      "data-beam-mode",
      "traveling",
    );
    expect(screen.getByTestId("media-composer-beam")).toHaveAttribute(
      "data-beam-playing",
      "true",
    );
    expect(screen.getByTestId("media-composer-beam")).toHaveAttribute(
      "data-beam-accent",
      "--accent-chatbot",
    );
  });

  // v2.2.3 Phase 2 (2.2): the beam wraps the INNER typing surface, sits inside
  // the outer composer box, and the send icon is neutral fg, not a pillar hue.
  it("wraps the inner typing surface with the beam, not the outer box", () => {
    render(
      <MediaComposer onSubmit={vi.fn()} submitAccentVar="--accent-image" />,
    );
    const beam = screen.getByTestId("media-composer-beam");
    const outer = screen.getByTestId("media-composer");
    const surface = screen.getByTestId("media-composer-surface");
    expect(beam.contains(surface)).toBe(true);
    expect(outer.contains(beam)).toBe(true);
    expect(beam.contains(outer)).toBe(false);
    expect(beam).toHaveAttribute("data-beam-accent", "--accent-chatbot");
    const submit = screen.getByTestId("media-composer-submit");
    expect(submit.style.color).toBe("var(--fg-0)");
  });

  it("uses an icon send with aria-label and no MetalAccent box", () => {
    render(<MediaComposer onSubmit={vi.fn()} submitLabel="Generate" />);
    const submit = screen.getByTestId("media-composer-submit");
    expect(submit).toHaveAttribute("aria-label", "Generate");
    expect(submit.querySelector("svg")).not.toBeNull();
    const caption = Array.from(submit.childNodes)
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => n.textContent?.trim())
      .join("");
    expect(caption).toBe("");
    expect(
      submit.closest("[data-testid='media-composer-submit-metal']"),
    ).toBeNull();
    const surface = screen.getByTestId("media-composer-surface");
    const actions = screen.getByTestId("media-composer-actions");
    expect(surface.contains(actions)).toBe(true);
    expect(actions.contains(screen.getByTestId("media-composer-add"))).toBe(
      true,
    );
    expect(actions.contains(submit)).toBe(true);
  });

  it("replaces Send with Stop while streaming and hides Stop when idle", () => {
    const onStop = vi.fn();
    const { rerender } = render(
      <MediaComposer onSubmit={vi.fn()} onStop={onStop} streaming />,
    );
    expect(screen.queryByTestId("media-composer-submit")).toBeNull();
    fireEvent.click(screen.getByTestId("media-composer-stop"));
    expect(onStop).toHaveBeenCalledTimes(1);
    rerender(<MediaComposer onSubmit={vi.fn()} onStop={onStop} />);
    expect(screen.queryByTestId("media-composer-stop")).toBeNull();
    expect(screen.getByTestId("media-composer-submit")).toBeDisabled();
  });
});
