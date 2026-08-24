import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MetalAccent } from "../src/components/MetalAccent";
import { resetMetalRegistry } from "../src/components/metalRegistry";
import { MotionActivityProvider, useMotionActivity } from "../src/motion/MotionActivity";

function RecedeFlag(): JSX.Element {
  const { isAmbientReceded } = useMotionActivity();
  return <span data-testid="receded">{String(isAmbientReceded)}</span>;
}

function stubGl(overrides: Record<string, unknown> = {}): WebGLRenderingContext {
  return {
    VERTEX_SHADER: 35633,
    FRAGMENT_SHADER: 35632,
    COMPILE_STATUS: 35713,
    LINK_STATUS: 35714,
    ARRAY_BUFFER: 34962,
    STATIC_DRAW: 35044,
    FLOAT: 5126,
    SRC_ALPHA: 770,
    ONE_MINUS_SRC_ALPHA: 771,
    BLEND: 3042,
    COLOR_BUFFER_BIT: 16384,
    TRIANGLES: 4,
    createShader: () => ({}),
    shaderSource: () => undefined,
    compileShader: () => undefined,
    getShaderParameter: () => true,
    deleteShader: () => undefined,
    createProgram: () => ({}),
    attachShader: () => undefined,
    linkProgram: () => undefined,
    getProgramParameter: () => true,
    useProgram: () => undefined,
    createBuffer: () => ({}),
    bindBuffer: () => undefined,
    bufferData: () => undefined,
    getAttribLocation: () => 0,
    enableVertexAttribArray: () => undefined,
    vertexAttribPointer: () => undefined,
    enable: () => undefined,
    blendFunc: () => undefined,
    getUniformLocation: () => ({}),
    viewport: () => undefined,
    clearColor: () => undefined,
    clear: () => undefined,
    uniform2f: () => undefined,
    uniform1f: () => undefined,
    uniform3f: () => undefined,
    drawArrays: () => undefined,
    ...overrides,
  } as unknown as WebGLRenderingContext;
}

function mockWebGl(overrides: Record<string, unknown> = {}, invokeLoop = true): () => void {
  const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((type) => {
    if (type === "webgl2" || type === "webgl") {
      return stubGl(overrides) as unknown as RenderingContext;
    }
    return null;
  });
  let painted = false;
  const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb: FrameRequestCallback) => {
    if (invokeLoop && !painted) {
      painted = true;
      cb(16);
    }
    return 1;
  });
  const caf = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
  return () => {
    getContext.mockRestore();
    raf.mockRestore();
    caf.mockRestore();
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetMetalRegistry();
});

describe("MetalAccent", () => {
  it("falls back when WebGL is unavailable", () => {
    render(
      <MetalAccent surfaceId="metal-fallback">
        <button type="button">Send</button>
      </MetalAccent>,
    );
    const host = screen.getByTestId("metal-accent");
    expect(host).toHaveAttribute("data-metal-fallback", "true");
    expect(host).toHaveAttribute("data-metal-animating", "false");
    expect(host).toHaveClass("nexus-metal-fallback");
  });

  it("falls back under reduced-motion even if WebGL exists", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    );
    const restore = mockWebGl();
    try {
      render(
        <MetalAccent surfaceId="metal-rm">
          <button type="button">Send</button>
        </MetalAccent>,
      );
      expect(screen.getByTestId("metal-accent")).toHaveAttribute("data-reduced-motion", "true");
      expect(screen.getByTestId("metal-accent")).toHaveAttribute("data-metal-fallback", "true");
    } finally {
      restore();
    }
  });

  it("animates when WebGL is stubbed", async () => {
    const restore = mockWebGl();
    try {
      render(
        <MetalAccent surfaceId="metal-anim" accentToken="--accent-chatbot">
          <button type="button">Send</button>
        </MetalAccent>,
      );
      await waitFor(() => {
        expect(screen.getByTestId("metal-accent")).toHaveAttribute("data-metal-animating", "true");
      });
      expect(screen.getByTestId("metal-accent")).toHaveAttribute("data-metal-fallback", "false");
      expect(screen.getByTestId("metal-accent")).toHaveAttribute("data-metal-accent", "--accent-chatbot");
    } finally {
      restore();
    }
  });

  it("caps simultaneous animating instances at three", async () => {
    const restore = mockWebGl();
    try {
      render(
        <>
          <MetalAccent surfaceId="m1" data-testid="metal-1">
            a
          </MetalAccent>
          <MetalAccent surfaceId="m2" data-testid="metal-2">
            b
          </MetalAccent>
          <MetalAccent surfaceId="m3" data-testid="metal-3">
            c
          </MetalAccent>
          <MetalAccent surfaceId="m4" data-testid="metal-4">
            d
          </MetalAccent>
        </>,
      );
      await waitFor(() => {
        expect(screen.getByTestId("metal-1")).toHaveAttribute("data-metal-animating", "true");
        expect(screen.getByTestId("metal-2")).toHaveAttribute("data-metal-animating", "true");
        expect(screen.getByTestId("metal-3")).toHaveAttribute("data-metal-animating", "true");
      });
      expect(screen.getByTestId("metal-4")).toHaveAttribute("data-metal-fallback", "true");
      expect(screen.getByTestId("metal-4")).toHaveAttribute("data-metal-animating", "false");
    } finally {
      restore();
    }
  });

  it("treats a missing IntersectionObserver as visible", async () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    const restore = mockWebGl();
    try {
      render(
        <MetalAccent surfaceId="metal-io-missing">
          x
        </MetalAccent>,
      );
      await waitFor(() => {
        expect(screen.getByTestId("metal-accent")).toHaveAttribute("data-metal-animating", "true");
      });
    } finally {
      restore();
    }
  });

  it("pauses when IntersectionObserver reports the host offscreen", async () => {
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
    const restore = mockWebGl();
    try {
      render(
        <MetalAccent surfaceId="metal-offscreen">
          x
        </MetalAccent>,
      );
      await waitFor(() => {
        expect(screen.getByTestId("metal-accent")).toHaveAttribute("data-metal-animating", "true");
      });
      act(() => {
        latest?.(
          [{ isIntersecting: false } as IntersectionObserverEntry],
          {} as IntersectionObserver,
        );
      });
      await waitFor(() => {
        expect(screen.getByTestId("metal-accent")).toHaveAttribute("data-metal-fallback", "true");
        expect(screen.getByTestId("metal-accent")).toHaveAttribute("data-metal-animating", "false");
      });
    } finally {
      restore();
    }
  });

  it("falls back when the GL program cannot compile", async () => {
    const restore = mockWebGl({ getShaderParameter: () => false }, false);
    try {
      render(
        <MetalAccent surfaceId="metal-compile-fail">
          <button type="button">Send</button>
        </MetalAccent>,
      );
      await waitFor(() => {
        expect(screen.getByTestId("metal-accent")).toHaveAttribute("data-metal-fallback", "true");
      });
    } finally {
      restore();
    }
  });

  it("registers recede-when-active only while animating", async () => {
    const restore = mockWebGl();
    function Harness(): JSX.Element {
      const [paused, setPaused] = useState(false);
      return (
        <MotionActivityProvider>
          <RecedeFlag />
          <MetalAccent surfaceId="metal-recede" paused={paused}>
            x
          </MetalAccent>
          <button type="button" data-testid="pause" onClick={() => setPaused(true)}>
            pause
          </button>
        </MotionActivityProvider>
      );
    }
    try {
      render(<Harness />);
      await waitFor(() => {
        expect(screen.getByTestId("receded").textContent).toBe("true");
      });
      fireEvent.click(screen.getByTestId("pause"));
      await waitFor(() => {
        expect(screen.getByTestId("receded").textContent).toBe("false");
      });
    } finally {
      restore();
    }
  });
});
