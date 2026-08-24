import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentStateOrb } from "../src/components/agentState/AgentStateOrb";
import { ORB_SIZE_HERO, ORB_SIZE_INLINE } from "../src/components/agentState/orbEngine";

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
    expect(screen.getByTestId("agent-state-orb-caption")).toHaveTextContent("Shaping...");
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
});
