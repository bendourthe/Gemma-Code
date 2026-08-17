import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConstellationBackground } from "../src/components/ConstellationBackground";
import {
  MotionActivityProvider,
  useActiveMotionSurface,
  useMotionActivity,
} from "../src/motion/MotionActivity";

function RecedeFlag(): JSX.Element {
  const { isAmbientReceded } = useMotionActivity();
  return <span data-testid="receded">{String(isAmbientReceded)}</span>;
}

function ToggleSurface(): JSX.Element {
  const [active, setActive] = useState(false);
  useActiveMotionSurface("reference", active);
  return (
    <button type="button" data-testid="toggle" onClick={() => setActive((value) => !value)}>
      toggle
    </button>
  );
}

function DualSurface(): JSX.Element {
  const [a, setA] = useState(true);
  const [b, setB] = useState(true);
  useActiveMotionSurface("a", a);
  useActiveMotionSurface("b", b);
  return (
    <>
      <button type="button" data-testid="off-a" onClick={() => setA(false)}>
        off a
      </button>
      <button type="button" data-testid="off-b" onClick={() => setB(false)}>
        off b
      </button>
    </>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
});

describe("MotionActivity recede-when-active", () => {
  it("starts with the ambient glow fully visible", () => {
    render(
      <MotionActivityProvider>
        <RecedeFlag />
      </MotionActivityProvider>,
    );
    expect(screen.getByTestId("receded").textContent).toBe("false");
  });

  it("toggles the ambient intensity flag on activate and deactivate", () => {
    render(
      <MotionActivityProvider>
        <ToggleSurface />
        <RecedeFlag />
      </MotionActivityProvider>,
    );
    expect(screen.getByTestId("receded").textContent).toBe("false");
    fireEvent.click(screen.getByTestId("toggle"));
    expect(screen.getByTestId("receded").textContent).toBe("true");
    fireEvent.click(screen.getByTestId("toggle"));
    expect(screen.getByTestId("receded").textContent).toBe("false");
  });

  it("stays receded until every active surface deactivates", () => {
    render(
      <MotionActivityProvider>
        <DualSurface />
        <RecedeFlag />
      </MotionActivityProvider>,
    );
    expect(screen.getByTestId("receded").textContent).toBe("true");
    fireEvent.click(screen.getByTestId("off-a"));
    expect(screen.getByTestId("receded").textContent).toBe("true");
    fireEvent.click(screen.getByTestId("off-b"));
    expect(screen.getByTestId("receded").textContent).toBe("false");
  });

  it("no-ops without a provider so isolated surfaces still render", () => {
    render(<RecedeFlag />);
    expect(screen.getByTestId("receded").textContent).toBe("false");
  });

  it("dims the constellation when a reference surface activates", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    render(
      <MotionActivityProvider>
        <ToggleSurface />
        <ConstellationBackground />
      </MotionActivityProvider>,
    );
    const canvas = screen.getByTestId("constellation");
    expect(canvas).toHaveAttribute("data-ambient-receded", "false");
    expect((canvas as HTMLElement).style.opacity).toBe("0.55");
    fireEvent.click(screen.getByTestId("toggle"));
    expect(canvas).toHaveAttribute("data-ambient-receded", "true");
    expect((canvas as HTMLElement).style.opacity).toBe("var(--motion-recede-opacity)");
    expect(canvas.className).toContain("nexus-ambient-recede");
    fireEvent.click(screen.getByTestId("toggle"));
    expect(canvas).toHaveAttribute("data-ambient-receded", "false");
    expect((canvas as HTMLElement).style.opacity).toBe("0.55");
  });
});
