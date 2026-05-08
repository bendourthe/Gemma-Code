// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import {
  compileQueuedMessageField,
  QUEUED_MESSAGE_FIELD_FN_SOURCE,
} from "../../../../../src/panels/webview/render/queuedMessageField.js";

const renderQueuedMessageField = compileQueuedMessageField(document);

function makeHandlers() {
  return {
    onAttach: vi.fn(),
    onStop: vi.fn(),
    onQueue: vi.fn<(text: string) => void>(),
  };
}

describe("renderQueuedMessageField", () => {
  it("renders an attach + input + stop trio with the queue placeholder", () => {
    const wrap = renderQueuedMessageField(makeHandlers());
    expect(wrap.querySelector(".queued-attach-btn")?.textContent).toBe("+");
    expect(
      wrap.querySelector<HTMLTextAreaElement>(".queued-input")?.placeholder,
    ).toBe("Queue another message...");
    expect(wrap.querySelector(".queued-stop-btn")?.textContent).toBe("■");
  });

  it("dispatches onQueue when Enter is pressed and clears the field", () => {
    const handlers = makeHandlers();
    const wrap = renderQueuedMessageField(handlers);
    const input = wrap.querySelector<HTMLTextAreaElement>(".queued-input")!;
    input.value = "follow-up";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(handlers.onQueue).toHaveBeenCalledWith("follow-up");
    expect(input.value).toBe("");
  });

  it("does NOT queue blank input", () => {
    const handlers = makeHandlers();
    const wrap = renderQueuedMessageField(handlers);
    const input = wrap.querySelector<HTMLTextAreaElement>(".queued-input")!;
    input.value = "   ";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(handlers.onQueue).not.toHaveBeenCalled();
  });

  it("dispatches onStop when the stop button is clicked", () => {
    const handlers = makeHandlers();
    const wrap = renderQueuedMessageField(handlers);
    wrap.querySelector<HTMLButtonElement>(".queued-stop-btn")!.click();
    expect(handlers.onStop).toHaveBeenCalled();
  });

  it("dispatches onAttach when the + button is clicked", () => {
    const handlers = makeHandlers();
    const wrap = renderQueuedMessageField(handlers);
    wrap.querySelector<HTMLButtonElement>(".queued-attach-btn")!.click();
    expect(handlers.onAttach).toHaveBeenCalled();
  });

  it("never assigns user-supplied text to innerHTML", () => {
    expect(QUEUED_MESSAGE_FIELD_FN_SOURCE.includes("innerHTML")).toBe(false);
  });
});
