import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentStateOrb } from "../src/components/agentState/AgentStateOrb";
import { ORB_SIZE_HERO, ORB_SIZE_INLINE, ORB_SIZE_BUBBLE, rectFullyInside } from "../src/components/agentState/orbEngine";
import { MessageList, TRANSCRIPT_GUTTER_PX } from "../src/shared/chat/MessageList";
import {
  PENDING_CAPTIONS,
  STUDIO_PENDING_CAPTIONS,
  longestPendingCaption,
  longestStudioCaption,
  shuffleStudioCaptions,
} from "../src/components/agentState/captionRotator";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AgentStateOrb", () => {
  it("renders the mapped state at both size presets", () => {
    const { rerender } = render(<AgentStateOrb activity="chat-streaming" size="inline" />);
    const orb = screen.getByRole("img", { name: /agent composing/i });
    expect(orb).toHaveAttribute("data-agent-state", "composing");
    expect(orb).toHaveAttribute("data-agent-activity", "chat-streaming");
    expect(orb).toHaveAttribute("data-orb-size", "inline");
    expect(orb).toHaveStyle({ width: `${ORB_SIZE_INLINE}px`, height: `${ORB_SIZE_INLINE}px` });

    rerender(<AgentStateOrb activity="image-generation" size="hero" />);
    const hero = screen.getByRole("img", { name: /agent shaping/i });
    expect(hero).toHaveAttribute("data-agent-state", "shaping");
    expect(hero).toHaveAttribute("data-orb-size", "hero");
    expect(hero).toHaveStyle({ width: `${ORB_SIZE_HERO}px`, height: `${ORB_SIZE_HERO}px` });

    rerender(<AgentStateOrb activity="chat-streaming" size="bubble" />);
    const bubble = screen.getByRole("img", { name: /agent composing/i });
    expect(bubble).toHaveAttribute("data-orb-size", "bubble");
    expect(bubble).toHaveStyle({ width: `${ORB_SIZE_BUBBLE}px`, height: `${ORB_SIZE_BUBBLE}px` });
    expect(ORB_SIZE_BUBBLE).toBeGreaterThan(ORB_SIZE_INLINE);
  });

  it("falls back to a static frame under reduced-motion", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    );
    render(<AgentStateOrb activity="coding-tool-use" />);
    const orb = screen.getByTestId("agent-state-orb");
    expect(orb).toHaveAttribute("data-reduced-motion", "true");
    expect(orb).toHaveAttribute("data-orb-paused", "true");
    expect(orb).toHaveAttribute("data-agent-state", "working");
  });

  it("shows the mapped caption when requested", () => {
    render(<AgentStateOrb activity="video-generation" size="hero" showCaption />);
    // v2.4.4 Phase 5.3: studio pending rotates its own pool; "Shaping" is gone.
    expect(STUDIO_PENDING_CAPTIONS).toContain(
      screen.getByTestId("agent-state-orb-caption").textContent,
    );
  });

  it("treats a missing IntersectionObserver as visible", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    render(<AgentStateOrb activity="chat-streaming" />);
    expect(screen.getByTestId("agent-state-orb")).toHaveAttribute("data-orb-paused", "false");
  });

  it("pauses when IntersectionObserver reports the orb offscreen", () => {
    type IoCallback = IntersectionObserverCallback;
    let latest: IoCallback | null = null;
    class FakeIO implements IntersectionObserver {
      readonly root = null;
      readonly rootMargin = "";
      readonly thresholds = [0];
      constructor(cb: IoCallback) {
        latest = cb;
      }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
      takeRecords(): IntersectionObserverEntry[] {
        return [];
      }
    }
    vi.stubGlobal("IntersectionObserver", FakeIO);
    render(<AgentStateOrb activity="chat-streaming" />);
    expect(screen.getByTestId("agent-state-orb")).toHaveAttribute("data-orb-paused", "false");
    act(() => {
      latest?.(
        [{ isIntersecting: false } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    });
    expect(screen.getByTestId("agent-state-orb")).toHaveAttribute("data-orb-paused", "true");
  });

  it("paints through a mocked 2d context when motion is allowed", () => {
    const ctx = {
      clearRect: vi.fn(),
      beginPath: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      globalAlpha: 1,
      fillStyle: "",
    };
    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockImplementation(() => ctx as unknown as CanvasRenderingContext2D);
    let painted = false;
    const raf = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((cb: FrameRequestCallback) => {
        if (!painted) {
          painted = true;
          cb(16);
        }
        return 1;
      });
    try {
      render(<AgentStateOrb activity="coding-tool-use" />);
      expect(ctx.clearRect).toHaveBeenCalled();
    } finally {
      getContext.mockRestore();
      raf.mockRestore();
    }
  });

  it("does not clip the rotating-caption canvas with the pill radius", () => {
    render(<AgentStateOrb activity="chat-streaming" size="bubble" rotateCaptions />);
    const pill = screen.getByTestId("agent-state-orb");
    const canvas = screen.getByTestId("agent-state-orb-canvas");
    expect(pill).toHaveAttribute("data-orb-pill", "true");
    expect(pill.style.overflow).toBe("visible");
    expect(screen.getByTestId("agent-state-orb-pill-chrome")).toBeInTheDocument();
    expect(rectFullyInside(
      { left: 8, right: 8 + ORB_SIZE_BUBBLE, top: 8, bottom: 8 + ORB_SIZE_BUBBLE },
      { left: 0, right: 160, top: 0, bottom: 8 + ORB_SIZE_BUBBLE + 8 },
    )).toBe(true);
    expect(canvas.parentElement).toBe(pill);
  });
});

/**
 * v2.4.4 Phase 1 (T003) -- transcript gutters and the pending pill.
 *
 * Field screenshot 1 showed the Searching pill drifted inches to the right of
 * the assistant bubbles above it, with its left glow cropped by the pane. The
 * cause was three stacked insets (list padding of 0, then `paddingInline` plus
 * an extra `paddingLeft` on the pending row, plus a 12px orb `marginLeft`).
 * These tests pin the replacement: exactly ONE gutter, owned by the list.
 */
describe("transcript gutters (v2.4.4 Phase 1)", () => {
  it("puts one equal gutter on both inline edges of the message list", () => {
    render(
      <MessageList
        messages={[
          { id: "u1", role: "user", content: "hello" },
          { id: "a1", role: "assistant", content: "hi" },
        ]}
      />,
    );
    const list = screen.getByTestId("message-list");
    // One value, both edges: the user bubble's right margin equals the
    // assistant bubble's left margin because the same padding produces both.
    expect(list.style.paddingInline).toBe(`${TRANSCRIPT_GUTTER_PX}px`);
    expect(TRANSCRIPT_GUTTER_PX).toBeGreaterThan(0);
    expect(list.style.boxSizing).toBe("border-box");
  });

  it("leaves the glow uncropped by keeping the list and its rows overflow-visible", () => {
    render(<MessageList messages={[{ id: "p1", role: "assistant", content: "", pending: true }]} />);
    expect(screen.getByTestId("message-list").style.overflow).toBe("visible");
    expect(screen.getByTestId("message-row-p1").style.overflow).toBe("visible");
    expect(screen.getByTestId("message-pending-p1").style.overflow).toBe("visible");
  });

  it("starts the pending pill on the assistant gutter and adds no second inset", () => {
    render(<MessageList messages={[{ id: "p1", role: "assistant", content: "", pending: true }]} />);
    const pending = screen.getByTestId("message-pending-p1");
    // Nothing between the list gutter and the pill may re-offset it.
    expect(pending.style.paddingInline).toBe("0px");
    const orb = screen.getByRole("img", { name: "Generating reply" });
    expect(orb.style.marginLeft).toBe("");
  });

  it("still sizes the pill by the longest chat caption", () => {
    render(<MessageList messages={[{ id: "p1", role: "assistant", content: "", pending: true }]} />);
    const orb = screen.getByRole("img", { name: "Generating reply" });
    expect(orb.style.minWidth).toContain(`${longestPendingCaption().length}ch`);
  });

  it("keeps studio hero pending centered without inheriting the chat pill chrome", () => {
    render(
      <MessageList
        messages={[
          { id: "s1", role: "assistant", content: "", pending: true, activity: "image-generation" },
        ]}
      />,
    );
    const pending = screen.getByTestId("message-pending-s1");
    expect(pending.style.alignItems).toBe("center");
    expect(pending.style.width).toBe("100%");
    const orb = screen.getByTestId("agent-state-orb");
    expect(orb).toHaveAttribute("data-orb-size", "hero");
    expect(orb).not.toHaveAttribute("data-orb-pill");
    expect(orb.style.minWidth).toBe("");
  });
});

/**
 * v2.4.4 Phase 5.3 (T021) -- studio pending captions.
 *
 * Image and Video pending showed one static "Shaping...", which reads as a
 * stuck word during a job that runs for minutes. Together with the orb
 * animation, a rotating caption is what tells the operator the runtime is
 * still working rather than hung.
 */
describe("studio pending captions (v2.4.4 Phase 5)", () => {
  it("offers exactly Creating, Crafting, and Generating", () => {
    expect([...STUDIO_PENDING_CAPTIONS]).toEqual([
      "Creating...",
      "Crafting...",
      "Generating...",
    ]);
    // "Shaping" was the static label and must not come back.
    expect(STUDIO_PENDING_CAPTIONS).not.toContain("Shaping...");
  });

  it("uses the studio pool for image and video pending, not the chat pool", () => {
    for (const activity of ["image-generation", "video-generation"] as const) {
      const { unmount } = render(<AgentStateOrb activity={activity} size="hero" showCaption />);
      const caption = screen.getByTestId("agent-state-orb-caption").textContent ?? "";
      expect(STUDIO_PENDING_CAPTIONS, activity).toContain(caption);
      expect(PENDING_CAPTIONS, activity).not.toContain(caption);
      unmount();
    }
  });

  it("leaves the chat pool alone", () => {
    render(<AgentStateOrb activity="chat-streaming" size="bubble" rotateCaptions />);
    const caption = screen.getByTestId("agent-state-orb-caption").textContent ?? "";
    expect(PENDING_CAPTIONS).toContain(caption);
    expect(STUDIO_PENDING_CAPTIONS).not.toContain(caption);
  });

  it("shuffles per bubble but always yields a caption from the pool", () => {
    // Injectable rand keeps this deterministic; the contract is that a
    // shuffle is a permutation, never a drop or a duplicate.
    const order = shuffleStudioCaptions(() => 0);
    expect([...order].sort()).toEqual([...STUDIO_PENDING_CAPTIONS].sort());
    expect(longestStudioCaption()).toBe("Generating...");
  });

  it("keeps a pending studio orb animating while a job is active", () => {
    render(
      <MessageList
        messages={[
          { id: "v1", role: "assistant", content: "", pending: true, activity: "video-generation" },
        ]}
      />,
    );
    // The pending orb is the liveness signal for a job that can run for
    // minutes; a paused orb is indistinguishable from a frozen shell.
    expect(screen.getByTestId("agent-state-orb")).toHaveAttribute("data-orb-paused", "false");
  });
});
