import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FloatingLogo } from "../src/components/FloatingLogo";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("FloatingLogo", () => {
  it("renders the transparent mark with the float class and glow filter", () => {
    render(<FloatingLogo />);
    const img = screen.getByTestId("floating-logo") as HTMLImageElement;
    expect(img.tagName).toBe("IMG");
    expect(img.getAttribute("src")).toBe("/icons/window-icon.png");
    expect(img.className).toContain("nexus-floating-logo");
    expect(img).toHaveAttribute("data-reduced-motion", "false");
    expect(img.style.filter).toContain("var(--glow-lg)");
    expect(img).toHaveAttribute("alt", "Nexus AI Studio");
  });

  it("maps the glow prop to the matching drop-shadow token", () => {
    render(<FloatingLogo glow="sm" />);
    const img = screen.getByTestId("floating-logo") as HTMLImageElement;
    expect(img.style.filter).toContain("var(--glow-sm)");
  });

  it("applies custom src, size, alt, and className", () => {
    render(
      <FloatingLogo
        src="/brand/mark.png"
        size={64}
        alt="Custom"
        className="hero"
        data-testid="fl"
      />,
    );
    const img = screen.getByTestId("fl") as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("/brand/mark.png");
    expect(img.getAttribute("width")).toBe("64");
    expect(img).toHaveAttribute("alt", "Custom");
    expect(img.className).toContain("hero");
    expect(img.className).toContain("nexus-floating-logo");
  });

  it("marks reduced motion through the shared hook", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    );
    render(<FloatingLogo />);
    expect(screen.getByTestId("floating-logo")).toHaveAttribute("data-reduced-motion", "true");
  });
});
