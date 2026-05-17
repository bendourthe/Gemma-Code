import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { App } from "../src/App";
import { ModulePlaceholder } from "../src/pages/ModulePlaceholder";
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

  it("renders module placeholders for non-coding pillars", () => {
    render(
      <MemoryRouter initialEntries={["/images"]}>
        <App telemetryStream={null} />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("placeholder-image")).toBeInTheDocument();
  });

  it("renders the styleguide page at /_styleguide", () => {
    render(
      <MemoryRouter initialEntries={["/_styleguide"]}>
        <App telemetryStream={null} />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("styleguide")).toBeInTheDocument();
  });
});

describe("ModulePlaceholder", () => {
  it("renders a custom message when provided", () => {
    render(<ModulePlaceholder moduleId="image" message="hello world" />);
    expect(screen.getByText("hello world")).toBeInTheDocument();
  });

  it("falls back to a default message", () => {
    render(<ModulePlaceholder moduleId="video" />);
    expect(screen.getByText(/coming online/i)).toBeInTheDocument();
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
  });
});
