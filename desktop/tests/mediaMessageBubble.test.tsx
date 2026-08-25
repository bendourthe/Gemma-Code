/**
 * v1.15.0 Phase 5 (Issue 5) -- MessageBubble media / attachment rendering.
 */

import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { MessageBubble } from "../src/shared/chat/MessageBubble";
import type { ChatMessage } from "../src/shared/chat/types";

afterEach(() => cleanup());

describe("MessageBubble media", () => {
  it("renders user attachments as thumbnails", () => {
    const msg: ChatMessage = {
      id: "u1",
      role: "user",
      content: "edit this",
      attachments: ["data:image/png;base64,AAA"],
    };
    render(<MessageBubble message={msg} />);
    expect(screen.getByTestId("message-attachment-u1-0")).toBeInTheDocument();
  });

  it("renders a generated image for an assistant media message", () => {
    const msg: ChatMessage = {
      id: "a1",
      role: "assistant",
      content: "",
      media: { kind: "image", src: "data:image/png;base64,BBB" },
    };
    render(<MessageBubble message={msg} />);
    expect((screen.getByTestId("message-media-a1") as HTMLImageElement).getAttribute("src")).toBe(
      "data:image/png;base64,BBB",
    );
    expect(screen.getByTestId("message-media-a1")).toHaveStyle({
      display: "block",
      maxHeight: "40vh",
      objectFit: "contain",
    });
    expect(screen.getByTestId("message-media-a1").getAttribute("style") ?? "").not.toMatch(/min-height:\s*8rem/);
    expect(screen.getByTestId("message-bubble-a1")).toHaveStyle({
      width: "fit-content",
    });
  });

  it("shows a pending indicator with progress", () => {
    const msg: ChatMessage = {
      id: "a2",
      role: "assistant",
      content: "",
      pending: true,
      progress: { step: 1, total: 4 },
    };
    render(<MessageBubble message={msg} />);
    expect(screen.getByTestId("message-pending-a2")).toBeInTheDocument();
    const orb = screen.getByRole("img", { name: /agent composing/i });
    expect(orb).toHaveAttribute("data-orb-size", "bubble");
    expect(orb.querySelector("canvas")?.style.height).toBe("48px");
    expect(screen.getByTestId("message-pending-a2")).toHaveStyle({
      justifyContent: "center",
      width: "100%",
    });
    expect(screen.getByText("Composing...")).toBeInTheDocument();
    expect(screen.queryByText("Generating...")).toBeNull();
  });

  it("centers Studio pending work around a captioned hero orb", () => {
    const msg: ChatMessage = {
      id: "studio-pending",
      role: "assistant",
      content: "",
      pending: true,
      activity: "image-generation",
    };
    render(<MessageBubble message={msg} />);
    expect(screen.getByRole("img", { name: /agent shaping/i })).toHaveAttribute("data-orb-size", "hero");
    expect(screen.getByText("Shaping...")).toBeInTheDocument();
    expect(screen.getByTestId("message-bubble-studio-pending").getAttribute("style")).toContain(
      "min-height: 12rem",
    );
    expect(screen.getByTestId("message-bubble-studio-pending")).toHaveStyle({ width: "100%" });
  });

  it("replaces undecodable generated media with a visible failure", () => {
    const onMediaError = vi.fn();
    const msg: ChatMessage = {
      id: "bad-media",
      role: "assistant",
      content: "",
      media: { kind: "image", src: "data:image/png;base64,bad" },
    };
    render(<MessageBubble message={msg} onMediaError={onMediaError} />);
    fireEvent.error(screen.getByTestId("message-media-bad-media"));
    expect(screen.getByText(/Generation failed: generated image could not be displayed/)).toBeInTheDocument();
    expect(onMediaError).toHaveBeenCalledWith(msg);
  });

  it("leaves a plain-text message unchanged (no media nodes)", () => {
    const msg: ChatMessage = { id: "t1", role: "assistant", content: "hello" };
    render(<MessageBubble message={msg} />);
    expect(screen.getByText("hello")).toBeInTheDocument();
    expect(screen.queryByTestId("message-media-t1")).toBeNull();
    expect(screen.queryByTestId("message-pending-t1")).toBeNull();
    expect(screen.getByTestId("message-bubble-t1")).toHaveStyle({ width: "fit-content" });
  });

  it("opens a preview dialog from compact media and closes it", () => {
    const msg: ChatMessage = {
      id: "preview-1",
      role: "assistant",
      content: "",
      media: { kind: "image", src: "data:image/png;base64,BBB" },
    };
    render(<MessageBubble message={msg} />);
    fireEvent.click(screen.getByTestId("message-media-preview-1"));
    expect(screen.getByTestId("message-media-dialog-preview-1")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("message-media-close-preview-1"));
    expect(screen.queryByTestId("message-media-dialog-preview-1")).toBeNull();
  });
});
