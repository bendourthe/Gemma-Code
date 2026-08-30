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
  it("renders the message content without a You label", () => {
    const msg: ChatMessage = { id: "m1", role: "user", content: "Hello world" };
    render(<MessageBubble message={msg} />);
    const bubble = screen.getByTestId("message-bubble-m1");
    expect(bubble).toHaveTextContent("Hello world");
    expect(bubble).not.toHaveTextContent("You");
    // v2.2.9 Phase 1.3: unknown counts omit the token span (no em dash).
    expect(screen.queryByTestId("message-tokens-m1")).toBeNull();
    expect(screen.queryByTestId("message-time-m1")).toBeNull();
    expect(bubble.getAttribute("data-role")).toBe("user");
    expect(screen.getByTestId("message-shell-m1").style.maxWidth).toBe("80%");
    expect(bubble.style.width).toBe("fit-content");
    expect(bubble.style.backgroundColor).toBe("var(--bubble-user, var(--bg-2))");
  });

  it("renders an assistant turn without an Assistant label", () => {
    const msg: ChatMessage = { id: "a1", role: "assistant", content: "Sure" };
    render(<MessageBubble message={msg} />);
    const bubble = screen.getByTestId("message-bubble-a1");
    expect(bubble).toHaveTextContent("Sure");
    expect(bubble).not.toHaveTextContent("Assistant");
    expect(screen.queryByTestId("message-tokens-a1")).toBeNull();
    expect(screen.getByTestId("message-shell-a1").style.maxWidth).toBe("80%");
    expect(bubble.style.backgroundColor).toBe("var(--bubble-assistant, var(--bg-1))");
  });

  it("renders time left and a focusable compact token total below the bubble", () => {
    const msg: ChatMessage = {
      id: "m2",
      role: "assistant",
      content: "The reply",
      timestamp: new Date(2026, 7, 25, 20, 34).toISOString(),
      reasoningTokens: 75,
      outputTokens: 96,
    };
    render(<MessageBubble message={msg} locale="en-US" />);
    const bubble = screen.getByTestId("message-bubble-m2");
    const meta = screen.getByTestId("message-meta-m2");
    expect(bubble.compareDocumentPosition(meta) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const tokens = screen.getByTestId("message-tokens-m2");
    expect(tokens).toHaveTextContent("(171 tokens)");
    expect(tokens).toHaveAttribute("tabindex", "0");
    expect(tokens).toHaveAttribute(
      "title",
      "Input: unavailable. Reasoning: 75. Output: 96.",
    );
    expect(tokens).toHaveStyle({ fontStyle: "italic" });
  });

  it("renders a bubble-free pending status with no metadata", () => {
    const msg: ChatMessage = {
      id: "p1",
      role: "assistant",
      content: "",
      pending: true,
      timestamp: new Date(2026, 7, 25, 20, 34).toISOString(),
    };
    render(<MessageBubble message={msg} locale="en-US" />);
    expect(screen.queryByTestId("message-meta-p1")).toBeNull();
    expect(screen.queryByTestId("message-time-p1")).toBeNull();
    expect(screen.queryByTestId("message-tokens-p1")).toBeNull();
    expect(screen.queryByTestId("message-bubble-p1")).toBeNull();
    expect(screen.getByTestId("message-pending-p1")).toHaveAttribute("role", "status");
  });

  it("keeps provider reasoning collapsed above the response and hides count-only reasoning", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <MessageBubble
        message={{
          id: "reasoned",
          role: "assistant",
          content: "Final answer",
          reasoningText: "Provider reasoning",
          reasoningTokens: 7,
        }}
      />,
    );
    const trigger = screen.getByRole("button", { name: "Reasoning (7 tokens)" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("Model-provided reasoning")).toBeNull();
    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText("Model-provided reasoning")).toHaveTextContent(
      "Provider reasoning",
    );
    rerender(
      <MessageBubble
        message={{ id: "count-only", role: "assistant", content: "Answer", reasoningTokens: 7 }}
      />,
    );
    expect(screen.queryByTestId("message-reasoning-count-only")).toBeNull();
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

  it("aligns user rows to the end and assistant rows to the start", () => {
    const messages: ChatMessage[] = [
      { id: "u1", role: "user", content: "hi" },
      { id: "a1", role: "assistant", content: "hello" },
    ];
    render(<MessageList messages={messages} />);
    const userRow = screen.getByTestId("message-row-u1");
    const assistantRow = screen.getByTestId("message-row-a1");
    expect(userRow).toHaveAttribute("data-role", "user");
    expect(assistantRow).toHaveAttribute("data-role", "assistant");
    expect(userRow.style.alignItems).toBe("flex-end");
    expect(assistantRow.style.alignItems).toBe("flex-start");
    expect(screen.getByTestId("message-shell-u1").style.maxWidth).toBe("80%");
    expect(screen.getByTestId("message-shell-a1").style.maxWidth).toBe("80%");
  });

  it("honours a custom emptyMessage", () => {
    render(<MessageList messages={[]} emptyMessage="No chats yet" />);
    expect(screen.getByTestId("message-list-empty")).toHaveTextContent("No chats yet");
  });

  it("shows one date heading per local day and discrete time plus tokens", () => {
    const day1 = new Date(2026, 7, 24, 14, 15).toISOString();
    const day1b = new Date(2026, 7, 24, 16, 0).toISOString();
    const day2 = new Date(2026, 7, 25, 9, 0).toISOString();
    render(
      <MessageList
        locale="en-US"
        messages={[
          { id: "u1", role: "user", content: "a", timestamp: day1, inputTokens: 12 },
          { id: "a1", role: "assistant", content: "b", timestamp: day1b, reasoningTokens: 12, outputTokens: 36 },
          { id: "u2", role: "user", content: "c", timestamp: day2, inputTokens: 3 },
        ]}
      />,
    );
    expect(screen.getByTestId("message-day-2026-08-24")).toHaveTextContent("Monday, August 24, 2026");
    expect(screen.getByTestId("message-day-2026-08-25")).toHaveTextContent("Tuesday, August 25, 2026");
    expect(screen.getAllByTestId(/^message-day-/)).toHaveLength(2);
    expect(screen.getByTestId("message-time-u1")).toHaveTextContent(/2:15/);
    expect(screen.getByTestId("message-tokens-u1")).toHaveTextContent("(12 tokens)");
    expect(screen.getByTestId("message-tokens-a1")).toHaveTextContent("(48 tokens)");
    expect(screen.queryByTestId("message-time-missing")).toBeNull();
  });

  it("skips the clock for missing or epoch timestamps", () => {
    render(
      <MessageList
        locale="en-US"
        messages={[
          { id: "u1", role: "user", content: "a", timestamp: "1970-01-01T00:00:00.000Z", inputTokens: 1 },
          { id: "a1", role: "assistant", content: "b" },
        ]}
      />,
    );
    expect(screen.queryByTestId(/^message-day-/)).toBeNull();
    expect(screen.queryByTestId("message-time-u1")).toBeNull();
    expect(screen.queryByTestId("message-time-a1")).toBeNull();
    // Unknown assistant counts omit the token span entirely.
    expect(screen.queryByTestId("message-tokens-a1")).toBeNull();
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

  it("wraps Send in metal", () => {
    render(<ChatInput onSubmit={() => undefined} />);
    expect(screen.getByTestId("chat-input-submit").closest("[data-testid='chat-input-submit-metal']")).not.toBeNull();
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

  it("renders an optional harness badge next to the select", () => {
    render(
      <ModelSelector
        models={[{ id: "a", displayName: "Alpha" }]}
        value="a"
        onChange={() => undefined}
        harnessLabel="plan-first"
      />,
    );
    expect(screen.getByTestId("model-selector-harness")).toHaveTextContent("plan-first");
  });

  it("omits the harness badge when no label is passed", () => {
    render(
      <ModelSelector
        models={[{ id: "a", displayName: "Alpha" }]}
        value="a"
        onChange={() => undefined}
      />,
    );
    expect(screen.queryByTestId("model-selector-harness")).toBeNull();
  });

  it("renders a tool-calling verified badge with provenance tooltip", () => {
    render(
      <ModelSelector
        models={[
          {
            id: "a",
            displayName: "Alpha",
            toolCallingVerified: true,
            toolCallingBenchmark: {
              suite: "nexus-catalog-agentic-flag",
              date: "2026-08-17",
              result: "pass",
            },
          },
        ]}
        value="a"
        onChange={() => undefined}
      />,
    );
    const badge = screen.getByTestId("model-selector-tool-calling");
    expect(badge).toHaveTextContent("tool-calling verified");
    expect(badge.getAttribute("title")).toContain("nexus-catalog-agentic-flag");
    expect(badge.getAttribute("title")).toContain("pass");
  });

  it("omits the tool-calling badge when the selected model is unverified", () => {
    render(
      <ModelSelector
        models={[{ id: "a", displayName: "Alpha" }]}
        value="a"
        onChange={() => undefined}
      />,
    );
    expect(screen.queryByTestId("model-selector-tool-calling")).toBeNull();
  });

  it("surfaces the LFM2.5-2.6B agentic catalog entry in the picker (v1.19.0 Phase 1)", () => {
    render(
      <ModelSelector
        models={[
          {
            id: "lfm2.5:2.6b",
            displayName: "LFM2.5 2.6B",
            task: "agentic",
            licenseNote:
              "Free commercial use is limited to entities under USD 10M annual revenue. This is a use restriction, not a download gate.",
          },
        ]}
        value="lfm2.5:2.6b"
        onChange={() => undefined}
      />,
    );
    const select = screen.getByTestId("model-selector") as HTMLSelectElement;
    const option = select.options[0];
    expect(option?.value).toBe("lfm2.5:2.6b");
    expect(option?.text).toBe("LFM2.5 2.6B");
    expect(option?.getAttribute("data-task")).toBe("agentic");
    expect(option?.title).toMatch(/use restriction/i);
  });
});
