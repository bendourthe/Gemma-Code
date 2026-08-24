import { describe, expect, it } from "vitest";

import {
  isUsablePathRef,
  MISSING_OUTPUT_TEXT,
  sessionTitleFromPrompt,
  studioTurnsToChatMessages,
} from "../src/shared/explorer/studioSessionMemory";
import type { StudioTurn } from "../../../core/generations/StudioSessionStore.types";

describe("studioSessionMemory", () => {
  it("rejects data: blobs as last-output paths", () => {
    expect(isUsablePathRef("data:image/png;base64,AAA")).toBe(false);
    expect(isUsablePathRef("/tmp/fox.png")).toBe(true);
    expect(isUsablePathRef("/tmp/fox.png", () => false)).toBe(false);
  });

  it("maps a missing assistant file to error text, not a blank complete", () => {
    const turns: StudioTurn[] = [
      {
        id: "u1",
        sessionId: "s1",
        role: "user",
        content: "a fox",
        mediaRef: null,
        createdAt: 1,
      },
      {
        id: "a1",
        sessionId: "s1",
        role: "assistant",
        content: "",
        mediaRef: "/tmp/gone.png",
        createdAt: 2,
      },
    ];
    const messages = studioTurnsToChatMessages(turns, { outputExists: () => false });
    expect(messages[1]?.content).toBe(MISSING_OUTPUT_TEXT);
    expect(messages[1]?.media).toBeUndefined();
  });

  it("titles a session from the first prompt", () => {
    expect(sessionTitleFromPrompt("  a fox in snow  ")).toBe("a fox in snow");
  });
});
