/**
 * v1.16.0 Phase 3 (adoption item A5) -- accept-aware attachment filtering.
 *
 * Before this phase the composer hard-filtered on `image/`, so a PDF was
 * silently dropped whatever `accept` said. These tests pin the new behaviour AND
 * pin that the image studios (which use the default `image/*`) are unchanged.
 */

import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { MediaComposer, fileMatchesAccept, isImageDataUrl } from "../src/shared/chat/MediaComposer";

function file(name: string, type: string): File {
  return new File(["x"], name, { type });
}

describe("fileMatchesAccept", () => {
  it("matches a wildcard subtype", () => {
    expect(fileMatchesAccept(file("a.png", "image/png"), "image/*")).toBe(true);
    expect(fileMatchesAccept(file("a.pdf", "application/pdf"), "image/*")).toBe(false);
  });

  it("matches an exact MIME type", () => {
    expect(fileMatchesAccept(file("a.pdf", "application/pdf"), "application/pdf")).toBe(true);
  });

  it("matches a comma-separated list", () => {
    const accept = "application/pdf,image/*";
    expect(fileMatchesAccept(file("a.pdf", "application/pdf"), accept)).toBe(true);
    expect(fileMatchesAccept(file("a.png", "image/png"), accept)).toBe(true);
    expect(fileMatchesAccept(file("a.txt", "text/plain"), accept)).toBe(false);
  });

  it("falls back to the extension when the platform reports no MIME type", () => {
    expect(fileMatchesAccept(file("scan.pdf", ""), ".pdf")).toBe(true);
    expect(fileMatchesAccept(file("scan.txt", ""), ".pdf")).toBe(false);
  });

  it("accepts everything for a wildcard or an empty accept", () => {
    expect(fileMatchesAccept(file("a.txt", "text/plain"), "*/*")).toBe(true);
    expect(fileMatchesAccept(file("a.txt", "text/plain"), "")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(fileMatchesAccept(file("A.PDF", "APPLICATION/PDF"), "application/pdf")).toBe(true);
  });
});

describe("isImageDataUrl", () => {
  it("distinguishes a renderable image from a document", () => {
    expect(isImageDataUrl("data:image/png;base64,AAAA")).toBe(true);
    expect(isImageDataUrl("data:application/pdf;base64,AAAA")).toBe(false);
  });
});

describe("MediaComposer attachment filtering", () => {
  it("accepts a PDF when the accept list allows it", async () => {
    const user = userEvent.setup();
    render(<MediaComposer onSubmit={() => {}} accept="application/pdf,image/*" />);
    await user.upload(screen.getByTestId("media-composer-file"), file("doc.pdf", "application/pdf"));
    await waitFor(() => expect(screen.getByTestId("media-composer-thumb-0")).toBeInTheDocument());
  });

  it("renders a PDF as a labelled chip, not a broken image", async () => {
    const user = userEvent.setup();
    render(<MediaComposer onSubmit={() => {}} accept="application/pdf,image/*" />);
    await user.upload(screen.getByTestId("media-composer-file"), file("doc.pdf", "application/pdf"));
    await waitFor(() => expect(screen.getByTestId("media-composer-doc-0")).toBeInTheDocument());
  });

  it("still drops a PDF for an image-only composer (studios unchanged)", async () => {
    const user = userEvent.setup();
    render(<MediaComposer onSubmit={() => {}} />);
    await user.upload(screen.getByTestId("media-composer-file"), file("doc.pdf", "application/pdf"));
    // Nothing attached: the thumbnail strip never renders.
    expect(screen.queryByTestId("media-composer-thumbs")).not.toBeInTheDocument();
  });

  it("emits the attachment as a data URL on submit", async () => {
    const user = userEvent.setup();
    let captured: readonly string[] = [];
    render(
      <MediaComposer
        onSubmit={(_text, attachments) => {
          captured = attachments;
        }}
        accept="application/pdf,image/*"
      />,
    );
    await user.upload(screen.getByTestId("media-composer-file"), file("doc.pdf", "application/pdf"));
    await waitFor(() => expect(screen.getByTestId("media-composer-thumb-0")).toBeInTheDocument());
    await user.click(screen.getByTestId("media-composer-submit"));
    await waitFor(() => expect(captured).toHaveLength(1));
    expect(captured[0]).toContain("base64,");
  });
});
