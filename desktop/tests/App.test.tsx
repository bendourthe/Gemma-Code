import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { App } from "../src/App";
import { StyleguidePage } from "../src/pages/Styleguide";

describe("App shell", () => {
  it("renders the sidebar and the dashboard at /", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <App telemetryStream={null} />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("sidebar")).toBeInTheDocument();
    expect(screen.getByTestId("dashboard")).toBeInTheDocument();
  });

  it("renders the Coding module at /coding (Phase 3)", () => {
    render(
      <MemoryRouter initialEntries={["/coding"]}>
        <App telemetryStream={null} />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("coding-page")).toBeInTheDocument();
  });

  it("renders the Chat module at /chatbot (Phase 4)", () => {
    render(
      <MemoryRouter initialEntries={["/chatbot"]}>
        <App telemetryStream={null} />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("chat-page")).toBeInTheDocument();
  });

  it("renders the Image Studio page at /images (Phase 6)", () => {
    render(
      <MemoryRouter initialEntries={["/images"]}>
        <App telemetryStream={null} />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("image-studio-page")).toBeInTheDocument();
  });

  it("renders the Video Lab page at /videos (Phase 7)", () => {
    render(
      <MemoryRouter initialEntries={["/videos"]}>
        <App telemetryStream={null} />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("video-lab-page")).toBeInTheDocument();
  });

  it("renders the styleguide page at /_styleguide", () => {
    render(
      <MemoryRouter initialEntries={["/_styleguide"]}>
        <App telemetryStream={null} />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("styleguide")).toBeInTheDocument();
  });

  it("mounts the frameless title bar and the ambient constellation backdrop (Phase 5)", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <App telemetryStream={null} />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("title-bar")).toBeInTheDocument();
    expect(screen.getByTestId("app-backdrop")).toBeInTheDocument();
    expect(screen.getByTestId("app-constellation")).toBeInTheDocument();
    expect(screen.getByTestId("app-backdrop")).toHaveAttribute("data-ambient-receded", "false");
  });

  it("recedes the ambient glow from the styleguide reference surface", () => {
    render(
      <MemoryRouter initialEntries={["/_styleguide"]}>
        <App telemetryStream={null} />
      </MemoryRouter>,
    );
    const backdrop = screen.getByTestId("app-backdrop");
    const constellation = screen.getByTestId("app-constellation");
    expect(backdrop).toHaveAttribute("data-ambient-receded", "false");
    expect(constellation).toHaveAttribute("data-ambient-receded", "false");

    fireEvent.click(screen.getByTestId("recede-reference-toggle"));
    expect(backdrop).toHaveAttribute("data-ambient-receded", "true");
    expect(backdrop.className).toContain("nexus-ambient-recede");
    expect(constellation).toHaveAttribute("data-ambient-receded", "true");
    expect((constellation as HTMLElement).style.opacity).toBe("var(--motion-recede-opacity)");

    fireEvent.click(screen.getByTestId("recede-reference-toggle"));
    expect(backdrop).toHaveAttribute("data-ambient-receded", "false");
    expect(constellation).toHaveAttribute("data-ambient-receded", "false");
  });
});


describe("Styleguide", () => {
  it("renders swatches for every surface and accent token", () => {
    render(<StyleguidePage />);
    expect(screen.getByTestId("swatch---bg-0")).toBeInTheDocument();
    expect(screen.getByTestId("swatch---accent-chatbot")).toBeInTheDocument();
    expect(screen.getByTestId("swatch---accent-coding")).toBeInTheDocument();
    expect(screen.getByTestId("swatch---accent-image")).toBeInTheDocument();
    expect(screen.getByTestId("swatch---accent-video")).toBeInTheDocument();
    expect(screen.getByTestId("recede-reference")).toBeInTheDocument();
  });
});
