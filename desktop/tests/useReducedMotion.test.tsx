import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useReducedMotion } from "../src/motion/useReducedMotion";

function Probe(): JSX.Element {
  const reduced = useReducedMotion();
  return <span data-testid="reduced">{String(reduced)}</span>;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("useReducedMotion", () => {
  it("reports false when motion is allowed", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    );
    render(<Probe />);
    expect(screen.getByTestId("reduced").textContent).toBe("false");
  });

  it("reports true when the platform requests reduced motion", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    );
    render(<Probe />);
    expect(screen.getByTestId("reduced").textContent).toBe("true");
  });

  it("updates when matchMedia fires a change event", () => {
    const listeners: Array<(event: { matches: boolean }) => void> = [];
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: false,
        addEventListener: (_type: string, cb: (event: { matches: boolean }) => void) => {
          listeners.push(cb);
        },
        removeEventListener: vi.fn(),
      })),
    );
    render(<Probe />);
    expect(screen.getByTestId("reduced").textContent).toBe("false");
    act(() => {
      listeners[0]!({ matches: true });
    });
    expect(screen.getByTestId("reduced").textContent).toBe("true");
  });

  it("does not throw when matchMedia is an incomplete stub", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: false })),
    );
    expect(() => render(<Probe />)).not.toThrow();
    expect(screen.getByTestId("reduced").textContent).toBe("false");
  });
});
