import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConstellationBackground } from "../src/components/ConstellationBackground";

function fakeCtx() {
  return {
    globalAlpha: 1,
    strokeStyle: "",
    fillStyle: "",
    lineWidth: 0,
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
  };
}

let rafCallbacks: FrameRequestCallback[];
let rafSpy: ReturnType<typeof vi.fn>;
let cancelSpy: ReturnType<typeof vi.fn>;

function mockContext(ctx: unknown) {
  return vi
    .spyOn(HTMLCanvasElement.prototype, "getContext")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .mockReturnValue(ctx as any);
}

function setHidden(hidden: boolean): void {
  Object.defineProperty(document, "hidden", { configurable: true, value: hidden });
}

beforeEach(() => {
  rafCallbacks = [];
  rafSpy = vi.fn((cb: FrameRequestCallback) => {
    rafCallbacks.push(cb);
    return rafCallbacks.length;
  });
  cancelSpy = vi.fn();
  vi.stubGlobal("requestAnimationFrame", rafSpy);
  vi.stubGlobal("cancelAnimationFrame", cancelSpy);
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: false })),
  );
  setHidden(false);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ConstellationBackground", () => {
  it("renders a decorative, non-interactive canvas", () => {
    mockContext(null);
    render(<ConstellationBackground />);
    const canvas = screen.getByTestId("constellation");
    expect(canvas.tagName).toBe("CANVAS");
    expect(canvas).toHaveAttribute("aria-hidden", "true");
    expect((canvas as HTMLElement).style.pointerEvents).toBe("none");
    expect((canvas as HTMLElement).style.position).toBe("fixed");
  });

  it("honors opacity / zIndex / className / testid props", () => {
    mockContext(null);
    render(
      <ConstellationBackground
        opacity={0.3}
        zIndex={5}
        className="bg"
        data-testid="c2"
      />,
    );
    const canvas = screen.getByTestId("c2") as HTMLElement;
    expect(canvas.style.opacity).toBe("0.3");
    expect(canvas.style.zIndex).toBe("5");
    expect(canvas.className).toContain("bg");
  });

  it("starts the animation loop when visible and motion is allowed", () => {
    const ctx = fakeCtx();
    mockContext(ctx);
    render(<ConstellationBackground />);
    expect(rafSpy).toHaveBeenCalledTimes(1);
    // Run one frame: steps + draws + reschedules.
    rafCallbacks[0]!(0);
    expect(ctx.clearRect).toHaveBeenCalled();
    expect(rafSpy).toHaveBeenCalledTimes(2);
  });

  it("renders a single static frame under reduced motion and never loops", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true })),
    );
    const ctx = fakeCtx();
    mockContext(ctx);
    render(<ConstellationBackground />);
    expect(rafSpy).not.toHaveBeenCalled();
    expect(ctx.clearRect).toHaveBeenCalledTimes(1);
    // A resize re-renders the static frame (reduced-motion resize branch).
    window.dispatchEvent(new Event("resize"));
    expect(ctx.clearRect).toHaveBeenCalledTimes(2);
    expect(rafSpy).not.toHaveBeenCalled();
  });

  it("pauses when the document is hidden and resumes when shown", () => {
    const ctx = fakeCtx();
    mockContext(ctx);
    render(<ConstellationBackground />);
    expect(rafSpy).toHaveBeenCalledTimes(1);

    setHidden(true);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(cancelSpy).toHaveBeenCalled();

    setHidden(false);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(rafSpy).toHaveBeenCalledTimes(2);
  });

  it("draws a static frame at mount when hidden, without starting a loop", () => {
    setHidden(true);
    const ctx = fakeCtx();
    mockContext(ctx);
    render(<ConstellationBackground />);
    expect(rafSpy).not.toHaveBeenCalled();
    expect(ctx.clearRect).toHaveBeenCalledTimes(1);
  });

  it("no-ops when a 2d context is unavailable", () => {
    mockContext(null);
    render(<ConstellationBackground />);
    expect(rafSpy).not.toHaveBeenCalled();
  });

  it("recomputes on window resize while animating", () => {
    const ctx = fakeCtx();
    const spy = mockContext(ctx);
    render(<ConstellationBackground />);
    expect(() => window.dispatchEvent(new Event("resize"))).not.toThrow();
    expect(spy).toHaveBeenCalled();
  });

  it("cancels the loop and detaches listeners on unmount", () => {
    const ctx = fakeCtx();
    mockContext(ctx);
    const { unmount } = render(<ConstellationBackground />);
    expect(rafSpy).toHaveBeenCalledTimes(1);
    unmount();
    expect(cancelSpy).toHaveBeenCalled();
  });
});
