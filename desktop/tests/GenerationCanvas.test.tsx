import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GenerationCanvas } from "../src/components/GenerationCanvas";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("GenerationCanvas", () => {
  it("renders a busy aurora region with three drift layers and a shimmer bar", () => {
    const { container } = render(<GenerationCanvas />);
    const box = screen.getByTestId("generation-canvas");
    expect(box.getAttribute("role")).toBe("img");
    expect(box.getAttribute("aria-busy")).toBe("true");
    expect(box.getAttribute("aria-label")).toBe("Generating");
    expect(container.querySelectorAll(".nexus-aurora-layer")).toHaveLength(3);
    expect(container.querySelector(".nexus-aurora-shimmer")).not.toBeNull();
    expect(box).toHaveAttribute("data-reduced-motion", "false");
    const orb = screen.getByRole("img", { name: /agent shaping/i });
    expect(orb).toHaveAttribute("data-agent-activity", "image-generation");
    expect(orb).toHaveAttribute("data-orb-size", "hero");
    const beam = screen.getByTestId("generation-canvas-beam");
    expect(beam).toHaveAttribute("data-beam-mode", "traveling");
    expect(beam).toHaveAttribute("data-beam-playing", "false");
    expect(beam).toHaveAttribute("data-beam-accent", "--accent-image");
    expect(box).toHaveAttribute("data-motion-winner", "orb");
  });

  it("overlays the live preview and materializes it with progress", () => {
    render(
      <GenerationCanvas
        previewSrc="data:image/png;base64,AAAA"
        progress={0.5}
        data-testid="gc"
      />,
    );
    const img = screen.getByTestId("gc-preview") as HTMLImageElement;
    expect(img.getAttribute("src")).toContain("base64,AAAA");
    // 0.35 + 0.65 * 0.5 = 0.675 -- the preview fades in with progress.
    expect(img.style.opacity).toBe("0.675");
  });

  it("omits the preview overlay when no previewSrc is given", () => {
    render(<GenerationCanvas data-testid="gc2" />);
    expect(screen.queryByTestId("gc2-preview")).toBeNull();
  });

  it("renders overlay children (e.g. the Video Lab thumbnail strip)", () => {
    render(
      <GenerationCanvas>
        <span data-testid="overlay-child">strip</span>
      </GenerationCanvas>,
    );
    expect(screen.getByTestId("overlay-child").textContent).toBe("strip");
  });

  it("clamps progress when out of range", () => {
    render(<GenerationCanvas previewSrc="x" progress={2} data-testid="gc3" />);
    // clamped to 1.0 -> opacity 1
    expect((screen.getByTestId("gc3-preview") as HTMLElement).style.opacity).toBe("1");
  });

  it("marks reduced motion through the shared hook", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    );
    render(<GenerationCanvas />);
    expect(screen.getByTestId("generation-canvas")).toHaveAttribute("data-reduced-motion", "true");
  });

  it("uses the video activity when tint is video", () => {
    render(<GenerationCanvas tint="video" />);
    expect(screen.getByRole("img", { name: /agent shaping/i })).toHaveAttribute(
      "data-agent-activity",
      "video-generation",
    );
    expect(screen.getByTestId("generation-canvas-beam")).toHaveAttribute(
      "data-beam-accent",
      "--accent-video",
    );
  });
});
