/**
 * v1.5.0 Phase 5 (adoption-ecosystem-2026-06 T016) -- PreviewPane tests.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PreviewPane } from "../src/components/PreviewPane";

describe("<PreviewPane>", () => {
  it("renders nothing when no artifact is set", () => {
    const { container } = render(<PreviewPane artifact={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders a text artifact verbatim", () => {
    render(
      <PreviewPane artifact={{ kind: "text", title: "output.txt", text: "file body" }} />,
    );
    expect(screen.getByTestId("preview-pane")).toBeInTheDocument();
    expect(screen.getByTestId("preview-pane-title")).toHaveTextContent("output.txt");
    expect(screen.getByTestId("preview-pane-text")).toHaveTextContent("file body");
  });

  it("reuses InteractiveArtifact for an HTML artifact", () => {
    render(
      <PreviewPane
        artifact={{
          kind: "html",
          title: "Tune",
          html: `<form data-nexus-artifact="true"><input name="x" value="1" /></form>`,
        }}
      />,
    );
    // The InteractiveArtifact renderer mounts its own host + copy control.
    expect(screen.getByTestId("interactive-artifact")).toBeInTheDocument();
    expect(screen.getByTestId("interactive-artifact-copy")).toBeInTheDocument();
  });

  it("shows the source URL when provided", () => {
    render(
      <PreviewPane
        artifact={{ kind: "html", html: "<p>page</p>", sourceUrl: "https://example.com/doc" }}
      />,
    );
    expect(screen.getByTestId("preview-pane-source")).toHaveTextContent(
      "https://example.com/doc",
    );
  });

  it("invokes onClose when the close button is clicked", () => {
    const onClose = vi.fn();
    render(
      <PreviewPane artifact={{ kind: "text", text: "x" }} onClose={onClose} />,
    );
    fireEvent.click(screen.getByTestId("preview-pane-close"));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("strips script vectors from HTML artifacts (via InteractiveArtifact)", () => {
    render(
      <PreviewPane
        artifact={{ kind: "html", html: `<p>safe</p><script>window.x=1</script>` }}
      />,
    );
    const body = screen.getByTestId("interactive-artifact-body");
    expect(body.querySelector("script")).toBeNull();
    expect(body).toHaveTextContent("safe");
  });
});
