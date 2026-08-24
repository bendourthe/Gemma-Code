import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccentBeam } from "../src/components/AccentBeam";
import { MotionActivityProvider, useMotionActivity } from "../src/motion/MotionActivity";

function RecedeFlag(): JSX.Element {
  const { isAmbientReceded } = useMotionActivity();
  return <span data-testid="receded">{String(isAmbientReceded)}</span>;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AccentBeam", () => {
  it("renders breathing and traveling modes", () => {
    const { rerender } = render(
      <AccentBeam mode="breathing" playing surfaceId="beam-a">
        <span>inner</span>
      </AccentBeam>,
    );
    const beam = screen.getByTestId("accent-beam");
    expect(beam).toHaveAttribute("data-beam-mode", "breathing");
    expect(beam).toHaveAttribute("data-beam-playing", "true");
    expect(beam).toHaveAttribute("data-beam-accent", "--accent-coding");
    expect(beam).toHaveTextContent("inner");

    rerender(
      <AccentBeam mode="traveling" playing accentToken="--accent-chatbot" surfaceId="beam-a">
        <span>inner</span>
      </AccentBeam>,
    );
    expect(screen.getByTestId("accent-beam")).toHaveAttribute("data-beam-mode", "traveling");
    expect(screen.getByTestId("accent-beam")).toHaveAttribute("data-beam-accent", "--accent-chatbot");
  });

  it("fades to paused without unmounting children", () => {
    render(
      <AccentBeam playing={false} surfaceId="beam-b">
        <span data-testid="child">kept</span>
      </AccentBeam>,
    );
    expect(screen.getByTestId("accent-beam")).toHaveAttribute("data-beam-playing", "false");
    expect(screen.getByTestId("child")).toBeInTheDocument();
  });

  it("clamps strength onto the CSS custom property", () => {
    render(
      <AccentBeam playing strength={0.5} surfaceId="beam-s">
        x
      </AccentBeam>,
    );
    expect(screen.getByTestId("accent-beam").style.getPropertyValue("--nexus-beam-strength")).toBe(
      "0.5",
    );
  });

  it("renders a static border under reduced-motion", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    );
    render(
      <AccentBeam playing surfaceId="beam-rm">
        x
      </AccentBeam>,
    );
    const beam = screen.getByTestId("accent-beam");
    expect(beam).toHaveAttribute("data-reduced-motion", "true");
    expect(beam).toHaveAttribute("data-beam-playing", "true");
  });

  it("registers recede-when-active while playing", () => {
    function Harness(): JSX.Element {
      const [playing, setPlaying] = useState(true);
      return (
        <MotionActivityProvider>
          <RecedeFlag />
          <AccentBeam playing={playing} surfaceId="beam-recede">
            x
          </AccentBeam>
          <button type="button" data-testid="pause" onClick={() => setPlaying(false)}>
            pause
          </button>
        </MotionActivityProvider>
      );
    }
    render(<Harness />);
    expect(screen.getByTestId("receded").textContent).toBe("true");
    fireEvent.click(screen.getByTestId("pause"));
    expect(screen.getByTestId("receded").textContent).toBe("false");
  });
});
