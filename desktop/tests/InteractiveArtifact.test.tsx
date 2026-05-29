import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { InteractiveArtifact } from "../src/components/InteractiveArtifact";

describe("InteractiveArtifact", () => {
  let clipboardSpy: ReturnType<typeof vi.fn>;
  let originalClipboard: typeof navigator.clipboard | undefined;

  beforeEach(() => {
    clipboardSpy = vi.fn().mockResolvedValue(undefined);
    originalClipboard = navigator.clipboard;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      writable: true,
      value: { writeText: clipboardSpy },
    });
  });

  afterEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      writable: true,
      value: originalClipboard,
    });
  });

  it("renders sanitised HTML and a Copy as JSON control", () => {
    render(
      <InteractiveArtifact
        html={`<form data-nexus-artifact="true"><input name="x" value="hi" /></form>`}
      />,
    );
    expect(screen.getByTestId("interactive-artifact")).toBeInTheDocument();
    expect(screen.getByTestId("interactive-artifact-copy")).toHaveTextContent(
      "Copy as JSON",
    );
  });

  it("strips <script> and event-handler attributes from the payload", () => {
    render(
      <InteractiveArtifact
        html={`<div onclick="alert(1)">click</div><script>window.x=1</script><form data-nexus-artifact="true"></form>`}
      />,
    );
    const body = screen.getByTestId("interactive-artifact-body");
    expect(body.innerHTML).not.toContain("script");
    expect(body.innerHTML).not.toContain("onclick");
    expect(body.innerHTML).toContain("click");
  });

  it("strips javascript: URLs from href attributes", () => {
    render(
      <InteractiveArtifact
        html={`<a href="javascript:alert('hi')">danger</a><form data-nexus-artifact="true"></form>`}
      />,
    );
    const body = screen.getByTestId("interactive-artifact-body");
    expect(body.innerHTML).not.toContain("javascript:");
    expect(body.innerHTML).toContain("danger");
  });

  it("collects form state and copies as JSON", async () => {
    let captured: string | undefined;
    render(
      <InteractiveArtifact
        html={`<form data-nexus-artifact="true">
          <input name="temperature" type="number" value="0.7" />
          <input name="model" value="gemma4:e4b" />
          <input name="thinking" type="checkbox" checked />
        </form>`}
        onCopy={(json) => {
          captured = json;
        }}
      />,
    );
    fireEvent.click(screen.getByTestId("interactive-artifact-copy"));
    await waitFor(() => expect(clipboardSpy).toHaveBeenCalledOnce());
    const payload = JSON.parse(clipboardSpy.mock.calls[0]![0] as string);
    expect(payload).toEqual({
      temperature: 0.7,
      model: "gemma4:e4b",
      thinking: true,
    });
    expect(captured).toBeDefined();
  });

  it("surfaces a confirmation message after a successful copy", async () => {
    render(
      <InteractiveArtifact
        html={`<form data-nexus-artifact="true"><input name="k" value="v" /></form>`}
      />,
    );
    fireEvent.click(screen.getByTestId("interactive-artifact-copy"));
    await waitFor(() =>
      expect(screen.getByTestId("interactive-artifact-confirmation")).toBeInTheDocument(),
    );
    expect(
      screen.getByTestId("interactive-artifact-confirmation"),
    ).toHaveTextContent(/Copied as JSON/);
  });

  it("warns when no form is present in the artifact", async () => {
    render(<InteractiveArtifact html={`<p>just text</p>`} />);
    fireEvent.click(screen.getByTestId("interactive-artifact-copy"));
    await waitFor(() =>
      expect(screen.getByTestId("interactive-artifact-confirmation")).toBeInTheDocument(),
    );
    expect(
      screen.getByTestId("interactive-artifact-confirmation"),
    ).toHaveTextContent(/No interactive form found/);
    expect(clipboardSpy).not.toHaveBeenCalled();
  });

  it("invokes transformPayload before serialising", async () => {
    render(
      <InteractiveArtifact
        html={`<form data-nexus-artifact="true"><input name="a" value="1" /></form>`}
        transformPayload={(raw) => ({ wrapped: raw })}
      />,
    );
    fireEvent.click(screen.getByTestId("interactive-artifact-copy"));
    await waitFor(() => expect(clipboardSpy).toHaveBeenCalledOnce());
    const payload = JSON.parse(clipboardSpy.mock.calls[0]![0] as string);
    expect(payload).toEqual({ wrapped: { a: "1" } });
  });
});
