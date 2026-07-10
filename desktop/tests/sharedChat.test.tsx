/**
 * Tests for the shared chat shell components (MessageList / MessageBubble /
 * ChatInput / ModelSelector).
 */

import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ChatInput,
  MessageBubble,
  MessageList,
  ModelSelector,
  type ChatMessage,
} from "../src/shared/chat";

describe("<MessageBubble>", () => {
  it("renders the message content and role label", () => {
    const msg: ChatMessage = { id: "m1", role: "user", content: "Hello world" };
    render(<MessageBubble message={msg} />);
    const bubble = screen.getByTestId("message-bubble-m1");
    expect(bubble).toHaveTextContent("Hello world");
    expect(bubble.getAttribute("data-role")).toBe("user");
  });

  it("renders the assistant label and matching style", () => {
    const msg: ChatMessage = { id: "a1", role: "assistant", content: "Sure" };
    render(<MessageBubble message={msg} />);
    expect(screen.getByTestId("message-bubble-a1")).toHaveTextContent(/Assistant/);
  });

  it("renders the system label", () => {
    const msg: ChatMessage = { id: "s1", role: "system", content: "boot" };
    render(<MessageBubble message={msg} />);
    expect(screen.getByTestId("message-bubble-s1")).toHaveTextContent(/System/);
  });

  it("renders tool cards when enableTools is true (default)", () => {
    const msg: ChatMessage = {
      id: "m1",
      role: "assistant",
      content: "Calling tool",
      toolCards: [{ callId: "c1", name: "read_file", args: '{"path":"x"}', result: "ok" }],
    };
    render(<MessageBubble message={msg} />);
    expect(screen.getByTestId("tool-card-c1")).toBeInTheDocument();
  });

  it("omits tool cards when enableTools is false", () => {
    const msg: ChatMessage = {
      id: "m1",
      role: "assistant",
      content: "x",
      toolCards: [{ callId: "c1", name: "n", args: "{}", result: null }],
    };
    render(<MessageBubble message={msg} enableTools={false} />);
    expect(screen.queryByTestId("tool-card-c1")).toBeNull();
  });

  it("tool card without result still renders the header", () => {
    const msg: ChatMessage = {
      id: "m1",
      role: "assistant",
      content: "x",
      toolCards: [{ callId: "c1", name: "n", args: "{}", result: null }],
    };
    render(<MessageBubble message={msg} />);
    expect(screen.getByTestId("tool-card-c1")).toBeInTheDocument();
  });
});

describe("<MessageList>", () => {
  it("renders an empty-state when messages is empty", () => {
    render(<MessageList messages={[]} />);
    expect(screen.getByTestId("message-list-empty")).toBeInTheDocument();
  });

  it("renders each message under its bubble id", () => {
    const messages: ChatMessage[] = [
      { id: "u1", role: "user", content: "hi" },
      { id: "a1", role: "assistant", content: "hello" },
    ];
    render(<MessageList messages={messages} />);
    expect(screen.getByTestId("message-bubble-u1")).toBeInTheDocument();
    expect(screen.getByTestId("message-bubble-a1")).toBeInTheDocument();
  });

  it("honours a custom emptyMessage", () => {
    render(<MessageList messages={[]} emptyMessage="No chats yet" />);
    expect(screen.getByTestId("message-list-empty")).toHaveTextContent("No chats yet");
  });
});

describe("<ChatInput>", () => {
  it("submits on Enter (without Shift) and clears the value", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<ChatInput onSubmit={onSubmit} />);
    const textarea = screen.getByTestId("chat-input-textarea");
    await user.type(textarea, "hello{Enter}");
    expect(onSubmit).toHaveBeenCalledWith("hello");
    expect(textarea).toHaveValue("");
  });

  it("inserts a newline on Shift+Enter without submitting", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<ChatInput onSubmit={onSubmit} />);
    const textarea = screen.getByTestId("chat-input-textarea");
    await user.type(textarea, "one{Shift>}{Enter}{/Shift}two");
    expect(onSubmit).not.toHaveBeenCalled();
    expect(textarea).toHaveValue("one\ntwo");
  });

  it("the submit button respects the disabled prop", () => {
    render(<ChatInput onSubmit={() => undefined} disabled />);
    expect(screen.getByTestId("chat-input-submit")).toBeDisabled();
  });

  it("clicking submit posts the trimmed value", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<ChatInput onSubmit={onSubmit} />);
    const textarea = screen.getByTestId("chat-input-textarea");
    await user.type(textarea, "  spaced  ");
    fireEvent.click(screen.getByTestId("chat-input-submit"));
    expect(onSubmit).toHaveBeenCalledWith("spaced");
  });

  it("does not submit on empty / whitespace-only value", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<ChatInput onSubmit={onSubmit} />);
    const textarea = screen.getByTestId("chat-input-textarea");
    await user.type(textarea, "   {Enter}");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("shows the accuracy disclaimer under the composer (v1.9.0 T033)", () => {
    render(<ChatInput onSubmit={() => undefined} />);
    const disclaimer = screen.getByTestId("chat-input-disclaimer");
    expect(disclaimer).toHaveTextContent(/runs locally and can make mistakes/i);
    expect(disclaimer).toHaveTextContent(/Verify important information/i);
  });
});

describe("<ModelSelector>", () => {
  it("renders every option and emits onChange on select", () => {
    const onChange = vi.fn();
    render(
      <ModelSelector
        models={[
          { id: "a", displayName: "Alpha" },
          { id: "b", displayName: "Beta" },
        ]}
        value="a"
        onChange={onChange}
      />,
    );
    const select = screen.getByTestId("model-selector") as HTMLSelectElement;
    expect(select.options.length).toBe(2);
    fireEvent.change(select, { target: { value: "b" } });
    expect(onChange).toHaveBeenCalledWith("b");
  });

  it("respects the disabled prop", () => {
    render(
      <ModelSelector
        models={[{ id: "a", displayName: "Alpha" }]}
        value="a"
        onChange={() => undefined}
        disabled
      />,
    );
    expect(screen.getByTestId("model-selector")).toBeDisabled();
  });
});
