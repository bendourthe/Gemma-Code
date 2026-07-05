import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { TitleBar } from "../src/components/TitleBar";
import type { WindowControls } from "../src/lib/windowControls";

afterEach(() => cleanup());

function fakeControls(initialMaximized = false): WindowControls & { maximized: boolean } {
  const state = { maximized: initialMaximized };
  return {
    get maximized() {
      return state.maximized;
    },
    minimize: vi.fn().mockResolvedValue(undefined),
    toggleMaximize: vi.fn().mockImplementation(async () => {
      state.maximized = !state.maximized;
    }),
    close: vi.fn().mockResolvedValue(undefined),
    isMaximized: vi.fn().mockImplementation(async () => state.maximized),
  };
}

describe("TitleBar", () => {
  it("renders the transparent mark and the Nexus AI Studio wordmark", () => {
    render(<TitleBar controls={fakeControls()} />);
    expect(screen.getByTestId("title-bar")).toBeInTheDocument();
    expect(screen.getByTestId("title-bar-title")).toHaveTextContent("Nexus AI Studio");
    const mark = screen.getByTestId("title-bar-mark") as HTMLImageElement;
    expect(mark.getAttribute("src")).toBe("/nexus-mark.png");
  });

  it("exposes a drag region for the frameless window move", () => {
    const { container } = render(<TitleBar controls={fakeControls()} />);
    expect(container.querySelector("[data-tauri-drag-region]")).not.toBeNull();
  });

  it("wires minimize / close to the window controls", () => {
    const controls = fakeControls();
    render(<TitleBar controls={controls} />);
    fireEvent.click(screen.getByTestId("title-bar-minimize"));
    expect(controls.minimize).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("title-bar-close"));
    expect(controls.close).toHaveBeenCalledTimes(1);
  });

  it("toggles maximize and swaps the button to a Restore affordance", async () => {
    const controls = fakeControls();
    render(<TitleBar controls={controls} />);
    const btn = screen.getByTestId("title-bar-maximize");
    expect(btn).toHaveAttribute("aria-label", "Maximize");
    fireEvent.click(btn);
    expect(controls.toggleMaximize).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(screen.getByTestId("title-bar-maximize")).toHaveAttribute("aria-label", "Restore"),
    );
  });

  it("reflects an already-maximized window on mount", async () => {
    render(<TitleBar controls={fakeControls(true)} />);
    await waitFor(() =>
      expect(screen.getByTestId("title-bar-maximize")).toHaveAttribute("aria-label", "Restore"),
    );
  });

  it("accepts a custom title and mark", () => {
    render(<TitleBar title="Custom" markSrc="/x.png" controls={fakeControls()} />);
    expect(screen.getByTestId("title-bar-title")).toHaveTextContent("Custom");
    expect((screen.getByTestId("title-bar-mark") as HTMLImageElement).getAttribute("src")).toBe(
      "/x.png",
    );
  });
});
