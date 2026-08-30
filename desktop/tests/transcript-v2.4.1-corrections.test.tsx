import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MessageBubble } from "../src/shared/chat/MessageBubble";
import { estimatedMessageUsage } from "../../core/chat/tokenUsage";

const REASONING = `The user said "Hi".
The user is greeting me.
I am Nexus, a helpful, concise local AI assistant.

Plan:

1. Acknowledge the greeting.
2. Offer assistance briefly.`;

describe("v2.4.1 transcript corrections", () => {
  it("renders honest in-bubble metadata and collapsed reasoning for the reported Hi fixture", () => {
    render(
      <>
        <MessageBubble
          message={{
            id: "user-hi",
            role: "user",
            content: "Hi",
            timestamp: "2026-08-30T10:22:00-07:00",
            messageUsage: estimatedMessageUsage("user", "Hi"),
          }}
        />
        <MessageBubble
          message={{
            id: "assistant-hi",
            role: "assistant",
            content: "Hello! How can I help you today?",
            reasoningText: REASONING,
            timestamp: "2026-08-30T10:22:10-07:00",
            requestUsage: {
              version: 1,
              inputTokens: 100,
              reasoningTokens: 40,
              outputTokens: 59,
              provenance: { accuracy: "exact", source: "provider" },
            },
            messageUsage: estimatedMessageUsage(
              "assistant",
              "Hello! How can I help you today?",
              REASONING,
            ),
          }}
        />
      </>,
    );

    const userTokens = screen.getByTestId("message-tokens-user-hi");
    expect(userTokens).not.toHaveAttribute("title");
    expect(userTokens).not.toHaveAttribute("tabindex");

    const assistantTokens = screen.getByTestId("message-tokens-assistant-hi");
    expect(assistantTokens).toHaveAttribute("title", expect.stringContaining("Estimated."));
    expect(assistantTokens).not.toHaveAttribute("title", expect.stringContaining("Input"));

    const bubble = screen.getByTestId("message-bubble-assistant-hi");
    expect(bubble.firstElementChild).toBe(screen.getByTestId("message-meta-assistant-hi"));
    expect(bubble).not.toHaveAttribute("role", "button");
    expect(bubble).not.toHaveAttribute("tabindex");

    const reasoningButton = screen.getByRole("button", { name: /Reasoning/ });
    expect(reasoningButton).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("Model-provided reasoning")).not.toBeInTheDocument();
    fireEvent.click(reasoningButton);
    expect(screen.getByLabelText("Model-provided reasoning").textContent).toBe(REASONING);
  });

  it("keeps the unbubbled pending lane inset and uncropped", () => {
    render(
      <MessageBubble
        message={{ id: "pending", role: "assistant", content: "", pending: true }}
      />,
    );
    expect(screen.getByTestId("message-pending-pending")).toHaveStyle({
      maxWidth: "min(100%, 24rem)",
      paddingInline: "var(--space-2)",
      boxSizing: "border-box",
      overflow: "visible",
    });
  });
});
