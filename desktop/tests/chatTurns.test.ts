import { afterEach, describe, expect, it, vi } from "vitest";
import {
  beginTurn,
  cancelTurn,
  completeTurn,
  inFlightTurn,
  isCurrentTurn,
  patchInFlight,
  resetChatTurns,
  subscribeCompletedTurns,
} from "../src/modules/chat/chatTurns";
import type { ChatMessage } from "../src/shared/chat/types";

// v2.4.8 follow-up (2026-09-07): one global cancellation counter meant a send
// in chat B discarded chat A's reply; re-opening a chat lost its pending
// bubble. Turns are now tracked per chat at module scope.
const pending = (id: string): ChatMessage => ({
  id,
  role: "assistant",
  content: "",
  pending: true,
  activity: "chat-streaming",
});

afterEach(() => resetChatTurns());

describe("chatTurns", () => {
  it("keeps turns independent per chat", () => {
    const a = beginTurn("A", pending("a1"));
    const b = beginTurn("B", pending("b1"));
    expect(isCurrentTurn("A", a)).toBe(true);
    expect(isCurrentTurn("B", b)).toBe(true);
    // A newer turn in B does not invalidate A.
    beginTurn("B", pending("b2"));
    expect(isCurrentTurn("A", a)).toBe(true);
    expect(isCurrentTurn("B", b)).toBe(false);
  });

  it("stop cancels only that chat's turn and drops its pending bubble", () => {
    const a = beginTurn("A", pending("a1"));
    beginTurn("B", pending("b1"));
    cancelTurn("A");
    expect(isCurrentTurn("A", a)).toBe(false);
    expect(inFlightTurn("A")).toBeNull();
    expect(inFlightTurn("B")?.assistantId).toBe("b1");
  });

  it("remembers the pending bubble for re-hydration and clears it on completion", () => {
    beginTurn("A", pending("a1"));
    patchInFlight("A", { content: "" });
    expect(inFlightTurn("A")?.pending.id).toBe("a1");
    const listener = vi.fn();
    subscribeCompletedTurns(listener);
    const message: ChatMessage = { id: "a1", role: "assistant", content: "Hi" };
    completeTurn({ chatId: "A", assistantId: "a1", message });
    expect(inFlightTurn("A")).toBeNull();
    expect(listener).toHaveBeenCalledWith({ chatId: "A", assistantId: "a1", message });
  });

  it("a stale completion does not clear a newer in-flight turn", () => {
    beginTurn("A", pending("a1"));
    beginTurn("A", pending("a2"));
    completeTurn({
      chatId: "A",
      assistantId: "a1",
      message: { id: "a1", role: "assistant", content: "old" },
    });
    expect(inFlightTurn("A")?.assistantId).toBe("a2");
  });
});
