/**
 * v1.15.0 Phase 5 (Issue 5) -- MessageBubble media / attachment rendering.
 */

import { afterEach, describe, it, expect } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

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
    expect(screen.getByRole("img", { name: /agent composing/i })).toBeInTheDocument();
    expect(screen.queryByText("Generating...")).toBeNull();
  });

  it("leaves a plain-text message unchanged (no media nodes)", () => {
    const msg: ChatMessage = { id: "t1", role: "assistant", content: "hello" };
    render(<MessageBubble message={msg} />);
    expect(screen.getByText("hello")).toBeInTheDocument();
    expect(screen.queryByTestId("message-media-t1")).toBeNull();
    expect(screen.queryByTestId("message-pending-t1")).toBeNull();
  });
});
