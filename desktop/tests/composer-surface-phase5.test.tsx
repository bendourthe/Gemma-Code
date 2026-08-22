/**
 * v2.2.0 Phase 5 (5.4) -- the single-surface composer.
 *
 * The user's complaint was concrete: "the + button is poorly designed... the
 * text input box should be the only box, with + and send integrated inside,
 * making sure they never overlap with the typed text". These tests pin that
 * structure, and the mic menu that replaced the five-button voice row.
 */

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { MediaComposer } from "../src/shared/chat/MediaComposer";

describe("composer structure", () => {
  it("renders one surface containing the field and both controls", () => {
    render(<MediaComposer onSubmit={() => undefined} />);
    const surface = screen.getByTestId("media-composer-surface");
    // The controls live INSIDE the field's surface, not beside it.
    expect(surface.contains(screen.getByTestId("media-composer-textarea"))).toBe(true);
    expect(surface.contains(screen.getByTestId("media-composer-add"))).toBe(true);
    expect(surface.contains(screen.getByTestId("media-composer-submit"))).toBe(true);
  });

  it("reserves padding so text cannot slide under the controls", () => {
    render(<MediaComposer onSubmit={() => undefined} />);
    const textarea = screen.getByTestId("media-composer-textarea") as HTMLTextAreaElement;
    // Left padding clears the + button; right padding clears send.
    expect(parseInt(textarea.style.paddingLeft, 10)).toBeGreaterThanOrEqual(40);
    expect(parseInt(textarea.style.paddingRight, 10)).toBeGreaterThanOrEqual(100);
  });

  it("reserves more right padding when the mic controls are present", () => {
    const { unmount } = render(<MediaComposer onSubmit={() => undefined} />);
    const withoutAudio = parseInt(
      (screen.getByTestId("media-composer-textarea") as HTMLTextAreaElement).style.paddingRight,
      10,
    );
    unmount();

    render(<MediaComposer onSubmit={() => undefined} audioEnabled />);
    const withAudio = parseInt(
      (screen.getByTestId("media-composer-textarea") as HTMLTextAreaElement).style.paddingRight,
      10,
    );
    expect(withAudio).toBeGreaterThan(withoutAudio);
  });

  it("caps growth and scrolls internally instead of expanding forever", () => {
    render(<MediaComposer onSubmit={() => undefined} />);
    const textarea = screen.getByTestId("media-composer-textarea") as HTMLTextAreaElement;
    expect(textarea.style.maxHeight).toBeTruthy();
    expect(textarea.style.overflowY).toBe("auto");
    expect(textarea.style.resize).toBe("none");
  });

  it("still submits typed text", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<MediaComposer onSubmit={onSubmit} />);
    await user.type(screen.getByTestId("media-composer-textarea"), "hello");
    await user.click(screen.getByTestId("media-composer-submit"));
    expect(onSubmit).toHaveBeenCalledWith("hello", []);
  });
});

describe("mic menu", () => {
  const voiceModes = [
    { id: "voice-loop", label: "Voice loop", onSelect: vi.fn() },
    { id: "vad", label: "Start VAD", active: true, onSelect: vi.fn() },
    { id: "hold", label: "Hold to talk", onSelect: vi.fn() },
  ];

  it("is absent when audio is off (studios keep no mic)", () => {
    render(<MediaComposer onSubmit={() => undefined} />);
    expect(screen.queryByTestId("media-composer-mic")).toBeNull();
    expect(screen.queryByTestId("media-composer-mic-menu-toggle")).toBeNull();
  });

  it("hides the voice modes until the chevron is opened", () => {
    render(<MediaComposer onSubmit={() => undefined} audioEnabled voiceModes={voiceModes} />);
    expect(screen.queryByTestId("media-composer-mic-menu")).toBeNull();
  });

  it("exposes every voice mode the old button row had", async () => {
    const user = userEvent.setup();
    render(<MediaComposer onSubmit={() => undefined} audioEnabled voiceModes={voiceModes} />);
    await user.click(screen.getByTestId("media-composer-mic-menu-toggle"));
    // All capabilities remain reachable, just not as five flat buttons.
    expect(screen.getByTestId("media-composer-voice-voice-loop")).toBeTruthy();
    expect(screen.getByTestId("media-composer-voice-vad")).toBeTruthy();
    expect(screen.getByTestId("media-composer-voice-hold")).toBeTruthy();
  });

  it("invokes the selected mode and closes the menu", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <MediaComposer
        onSubmit={() => undefined}
        audioEnabled
        voiceModes={[{ id: "vad", label: "Start VAD", onSelect }]}
      />,
    );
    await user.click(screen.getByTestId("media-composer-mic-menu-toggle"));
    await user.click(screen.getByTestId("media-composer-voice-vad"));
    expect(onSelect).toHaveBeenCalled();
    expect(screen.queryByTestId("media-composer-mic-menu")).toBeNull();
  });

  it("marks the active mode for assistive tech", async () => {
    const user = userEvent.setup();
    render(<MediaComposer onSubmit={() => undefined} audioEnabled voiceModes={voiceModes} />);
    await user.click(screen.getByTestId("media-composer-mic-menu-toggle"));
    expect(
      screen.getByTestId("media-composer-voice-vad").getAttribute("aria-pressed"),
    ).toBe("true");
  });
});
