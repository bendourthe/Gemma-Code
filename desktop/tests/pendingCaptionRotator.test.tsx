/**
 * v2.2.9 Phase 2.1 (T006) -- pending-orb caption rotator.
 *
 * Contract: while a chat/agents reply is pending, the orb pill cycles
 * captions from the fixed Thinking / Searching / Working / Solving list,
 * shuffled once per bubble and rotated on a fixed interval; reduced-motion
 * holds the first caption; the accessible name is stable; and the reference
 * `thinking-orbs` package is never a dependency.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentStateOrb } from "../src/components/agentState/AgentStateOrb";
import {
  CAPTION_ROTATE_INTERVAL_MS,
  PENDING_CAPTIONS,
  pendingCaptionState,
  shufflePendingCaptions,
} from "../src/components/agentState/captionRotator";
import { MessageBubble } from "../src/shared/chat/MessageBubble";
import type { ChatMessage } from "../src/shared/chat/types";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function captionText(): string {
  return screen.getByTestId("agent-state-orb-caption").textContent ?? "";
}

describe("shufflePendingCaptions", () => {
  it("returns a permutation of the fixed list without mutating it", () => {
    const before = [...PENDING_CAPTIONS];
    const order = shufflePendingCaptions(() => 0);
    expect([...PENDING_CAPTIONS]).toEqual(before);
    expect(order).toHaveLength(PENDING_CAPTIONS.length);
    expect(new Set(order)).toEqual(new Set(PENDING_CAPTIONS));
  });

  it("is deterministic for a seeded rand", () => {
    const a = shufflePendingCaptions(() => 0.5);
    const b = shufflePendingCaptions(() => 0.5);
    expect(a).toEqual(b);
  });
});

describe("pendingCaptionState", () => {
  it("maps each caption to its matching orb grammar", () => {
    expect(pendingCaptionState("Thinking...")).toBe("composing");
    expect(pendingCaptionState("Searching...")).toBe("searching");
    expect(pendingCaptionState("Working...")).toBe("working");
    expect(pendingCaptionState("Solving...")).toBe("solving");
  });
});

describe("AgentStateOrb rotateCaptions", () => {
  it("cycles all fixed captions on the interval, in a per-mount stable order", () => {
    vi.useFakeTimers();
    render(<AgentStateOrb activity="chat-streaming" size="bubble" rotateCaptions />);
    const seen: string[] = [captionText()];
    for (let step = 0; step < PENDING_CAPTIONS.length - 1; step += 1) {
      act(() => {
        vi.advanceTimersByTime(CAPTION_ROTATE_INTERVAL_MS);
      });
      seen.push(captionText());
    }
    // One full cycle covers exactly the fixed list.
    expect(new Set(seen)).toEqual(new Set(PENDING_CAPTIONS));
    // The one-time shuffle is stable: the next cycle repeats the same order.
    const repeat: string[] = [];
    for (let step = 0; step < PENDING_CAPTIONS.length; step += 1) {
      act(() => {
        vi.advanceTimersByTime(CAPTION_ROTATE_INTERVAL_MS);
      });
      repeat.push(captionText());
    }
    expect(repeat).toEqual(seen);
  });

  it("respects the interval: no rotation before it elapses", () => {
    vi.useFakeTimers();
    render(<AgentStateOrb activity="chat-streaming" size="bubble" rotateCaptions />);
    const first = captionText();
    act(() => {
      vi.advanceTimersByTime(CAPTION_ROTATE_INTERVAL_MS - 1);
    });
    expect(captionText()).toBe(first);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(captionText()).not.toBe(first);
  });

  it("holds the first fixed caption under reduced motion", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    );
    vi.useFakeTimers();
    render(<AgentStateOrb activity="chat-streaming" size="bubble" rotateCaptions />);
    expect(captionText()).toBe(PENDING_CAPTIONS[0]);
    act(() => {
      vi.advanceTimersByTime(CAPTION_ROTATE_INTERVAL_MS * 3);
    });
    expect(captionText()).toBe(PENDING_CAPTIONS[0]);
    expect(screen.getByTestId("agent-state-orb")).toHaveAttribute("data-orb-paused", "true");
  });

  it("exposes one stable accessible name and hides the caption from readers", () => {
    vi.useFakeTimers();
    render(<AgentStateOrb activity="chat-streaming" size="bubble" rotateCaptions />);
    const orb = screen.getByRole("img", { name: "Generating reply" });
    act(() => {
      vi.advanceTimersByTime(CAPTION_ROTATE_INTERVAL_MS);
    });
    // The name never follows the rotation.
    expect(orb).toHaveAccessibleName("Generating reply");
    const caption = screen.getByTestId("agent-state-orb-caption");
    expect(caption).toHaveAttribute("aria-hidden", "true");
    expect(caption).toHaveAttribute("aria-live", "off");
  });

  it("renders the dark pill chrome only in rotate mode", () => {
    const { rerender } = render(
      <AgentStateOrb activity="chat-streaming" size="bubble" rotateCaptions />,
    );
    expect(screen.getByTestId("agent-state-orb")).toHaveAttribute("data-orb-pill", "true");
    rerender(<AgentStateOrb activity="image-generation" size="hero" showCaption />);
    expect(screen.getByTestId("agent-state-orb")).not.toHaveAttribute("data-orb-pill");
  });
});

describe("MessageBubble pending pill", () => {
  it("mounts the chat pending orb as a rotating bubble pill named Generating reply", () => {
    const msg: ChatMessage = { id: "p1", role: "assistant", content: "", pending: true };
    render(<MessageBubble message={msg} />);
    const orb = screen.getByRole("img", { name: "Generating reply" });
    expect(orb).toHaveAttribute("data-orb-size", "bubble");
    expect(orb).toHaveAttribute("data-orb-pill", "true");
    expect(PENDING_CAPTIONS).toContain(captionText());
  });

  it("keeps Image/Video pending on the hero preset without the pill", () => {
    const msg: ChatMessage = {
      id: "p2",
      role: "assistant",
      content: "",
      pending: true,
      activity: "image-generation",
    };
    render(<MessageBubble message={msg} />);
    const orb = screen.getByRole("img", { name: /agent shaping/i });
    expect(orb).toHaveAttribute("data-orb-size", "hero");
    expect(orb).not.toHaveAttribute("data-orb-pill");
    expect(captionText()).toBe("Shaping...");
  });
});

describe("thinking-orbs stays reference-only", () => {
  it("is absent from desktop/package.json", () => {
    const pkg = readFileSync(join(__dirname, "..", "package.json"), "utf8");
    expect(pkg).not.toContain("thinking-orbs");
  });

  it("is absent from the workspace package-lock.json", () => {
    const lock = readFileSync(join(__dirname, "..", "..", "package-lock.json"), "utf8");
    expect(lock).not.toContain("thinking-orbs");
  });
});
