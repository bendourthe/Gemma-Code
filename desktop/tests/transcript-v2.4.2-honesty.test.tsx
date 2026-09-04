/**
 * v2.4.2 Phase 2 -- transcript honesty: stick-to-bottom, session visual cap,
 * generic delete copy, and short generated titles (never the 45-char prompt slice).
 */

import { describe, expect, it } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { useEffect } from "react";

import {
  SESSION_VISUAL_CAP_DEFAULT,
  sessionContextUsage,
} from "../../core/chat/sessionContextUsage";
import { fallbackTitle } from "../sidecar/src/chat/titleGenerator";
import { useStickToBottom } from "../src/shared/chat/useStickToBottom";
import { sessionTitleFromPrompt } from "../src/shared/explorer/studioSessionMemory";
import {
  applyImmediateFallbackTitle,
  DEFAULT_SESSION_TITLE,
  refineGeneratedTitle,
  shouldTitleOnFirstSend,
} from "../src/shared/explorer/scheduleFirstPromptTitle";
import {
  deleteConfirmCopy,
  rangeSelectKeys,
} from "../src/modules/chat/folderTreeDeleteCopy";

describe("useStickToBottom", () => {
  it("composer stickNow jumps to the bottom after the user has scrolled up", () => {
    const box: { stickNow: () => void } = { stickNow: () => undefined };
    function Harness(): JSX.Element {
      const { scrollRef, onScroll, stickNow } = useStickToBottom(1);
      useEffect(() => {
        box.stickNow = stickNow;
      }, [stickNow]);
      return (
        <div
          data-testid="scroller"
          ref={(el) => {
            scrollRef.current = el;
            if (!el) return;
            Object.defineProperty(el, "scrollHeight", {
              configurable: true,
              value: 900,
            });
            Object.defineProperty(el, "clientHeight", {
              configurable: true,
              value: 200,
            });
          }}
          onScroll={onScroll}
        />
      );
    }
    const { getByTestId } = render(<Harness />);
    const scroller = getByTestId("scroller");
    scroller.scrollTop = 10;
    fireEvent.scroll(scroller);
    expect(scroller.scrollTop).toBe(10);
    box.stickNow();
    expect(scroller.scrollTop).toBe(900);
  });
});

describe("session visual footer cap", () => {
  it("one generated image is not 100% when catalog maxImages is 1", () => {
    const usage = sessionContextUsage({
      turns: [{ role: "assistant", visualUnits: 1 }],
      contextWindow: null,
      visualTokenBudget: { maxImages: 1 },
    });
    expect(SESSION_VISUAL_CAP_DEFAULT).toBe(8);
    expect(usage.percent).toBe(12.5);
    expect(usage.percent).not.toBe(100);
  });

  it("two generated images are 2/N of the session cap", () => {
    const usage = sessionContextUsage({
      turns: [
        { role: "assistant", visualUnits: 1 },
        { role: "assistant", visualUnits: 1 },
      ],
      contextWindow: null,
      visualTokenBudget: { maxImages: 1 },
    });
    expect(usage.percent).toBe((2 / SESSION_VISUAL_CAP_DEFAULT) * 100);
  });

  it("keeps the LLM window path unchanged", () => {
    const usage = sessionContextUsage({
      turns: [{ inputTokens: 40, outputTokens: 10 }],
      contextWindow: 100,
      visualTokenBudget: { maxImages: 1 },
    });
    expect(usage.denominatorKind).toBe("llm");
    expect(usage.percent).toBe(50);
  });
});

describe("generic delete copy", () => {
  it("never interpolates a title", () => {
    const copy = deleteConfirmCopy([{ kind: "chat", id: "c1" }]);
    expect(copy.question).toBe("Delete the selected session?");
    expect(copy.irreversible).toBe("This action cannot be undone.");
    expect(copy.question).not.toMatch(/puppy|prompt/i);
  });

  it("uses chats / folder / items wording", () => {
    expect(
      deleteConfirmCopy([
        { kind: "chat", id: "a" },
        { kind: "chat", id: "b" },
      ]).question,
    ).toBe("Delete the selected sessions?");
    expect(deleteConfirmCopy([{ kind: "folder", id: "f" }]).question).toBe(
      "Delete the selected folder?",
    );
    expect(
      deleteConfirmCopy([
        { kind: "chat", id: "a" },
        { kind: "folder", id: "f" },
      ]).question,
    ).toBe("Delete the selected items?");
  });

  it("range-selects contiguous keys", () => {
    expect(rangeSelectKeys(["a", "b", "c", "d"], 1, 3)).toEqual([
      "b",
      "c",
      "d",
    ]);
  });
});

describe("concise session titles", () => {
  it("fallback is about 6 words and is not the 45-character prompt slice", () => {
    const prompt =
      "Make that puppy black with a very long extra description that would formerly become the durable rail title";
    const fallback = fallbackTitle(prompt);
    expect(fallback.split(" ").length).toBeLessThanOrEqual(6);
    expect(fallback).not.toBe(sessionTitleFromPrompt(prompt));
    expect(fallback.length).toBeLessThan(sessionTitleFromPrompt(prompt).length);
  });

  it("immediate rename uses the short fallback", async () => {
    const renamed: string[] = [];
    const title = await applyImmediateFallbackTitle({
      sessionId: "s1",
      prompt: "a fox in snow please make it cinematic",
      currentTitle: DEFAULT_SESSION_TITLE,
      rename: (_id, next) => {
        renamed.push(next);
      },
    });
    expect(title).toBe("a fox in snow please make");
    expect(renamed).toEqual(["a fox in snow please make"]);
  });

  it("titles only the first send of an untitled empty session", () => {
    expect(
      shouldTitleOnFirstSend({
        title: DEFAULT_SESSION_TITLE,
        turnCount: 0,
        prompt: "Generate image of a puppy",
      }),
    ).toBe(true);
    expect(
      shouldTitleOnFirstSend({
        title: DEFAULT_SESSION_TITLE,
        turnCount: 0,
        prompt: "   ",
      }),
    ).toBe(false);
    expect(
      shouldTitleOnFirstSend({
        title: "Puppy generation",
        turnCount: 0,
        prompt: "Generate image of a puppy",
      }),
    ).toBe(false);
    expect(
      shouldTitleOnFirstSend({
        title: DEFAULT_SESSION_TITLE,
        turnCount: 2,
        prompt: "Generate image of a puppy",
      }),
    ).toBe(false);
    expect(
      shouldTitleOnFirstSend({
        title: DEFAULT_SESSION_TITLE,
        userRenamed: true,
        turnCount: 0,
        prompt: "Generate image of a puppy",
      }),
    ).toBe(false);
  });

  it("generated title overwrites fallback unless the user renamed", async () => {
    const renamed: string[] = [];
    await refineGeneratedTitle({
      sessionId: "s1",
      prompt: "a fox",
      rename: (_id, next) => {
        renamed.push(next);
      },
      generateTitle: async () => ({ title: "Snow Fox" }),
    });
    expect(renamed).toEqual(["Snow Fox"]);
    renamed.length = 0;
    await refineGeneratedTitle({
      sessionId: "s1",
      prompt: "a fox",
      userRenamed: true,
      rename: (_id, next) => {
        renamed.push(next);
      },
      generateTitle: async () => ({ title: "Snow Fox" }),
    });
    expect(renamed).toEqual([]);
  });
});
