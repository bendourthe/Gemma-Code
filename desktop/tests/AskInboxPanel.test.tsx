import { describe, expect, it } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { AskInboxPanel } from "../src/pages/inbox/AskInboxPanel";
import { createMockAskInboxClient } from "../src/pages/inbox/mockAskInboxClient";
import type { ParkedAskDto } from "../src/pages/inbox/askInboxTypes";

function pendingAsk(id = "ask-1"): ParkedAskDto {
  return {
    id,
    state: "pending",
    runMode: "headless",
    createdAt: 1_700_000_000_000,
    expiresAt: 1_700_008_640_000,
    toolName: "write_file",
    summary: "Run write_file?",
    detail: "tier CONFIRM",
    args: { path: "a.ts", content: "x" },
    risk: "destructive",
    classificationReason: "writes a file",
    parkedTier: 1,
    runId: "acp:sess",
  };
}

describe("AskInboxPanel", () => {
  it("lists parked asks and shows the pending count", async () => {
    render(
      <AskInboxPanel
        client={createMockAskInboxClient([pendingAsk()])}
        now={() => 1_700_000_030_000}
      />,
    );
    await waitFor(() => expect(screen.getByTestId("ask-inbox-pending-count")).toHaveTextContent("1 pending"));
    expect(screen.getByTestId("ask-inbox-item-ask-1")).toHaveTextContent("write_file");
    expect(screen.getByTestId("ask-inbox-meta-ask-1")).toHaveTextContent("CONFIRM");
    expect(screen.getByTestId("ask-inbox-meta-ask-1")).toHaveTextContent("headless");
  });

  it("approve moves the ask out of pending", async () => {
    const client = createMockAskInboxClient([pendingAsk()]);
    render(<AskInboxPanel client={client} now={() => 1_700_000_030_000} />);
    await waitFor(() => screen.getByTestId("ask-inbox-approve-ask-1"));
    fireEvent.click(screen.getByTestId("ask-inbox-approve-ask-1"));
    await waitFor(() => expect(screen.getByTestId("ask-inbox-pending-count")).toHaveTextContent("0 pending"));
    expect(screen.getByTestId("ask-inbox-history-ask-1")).toHaveTextContent("approved");
  });

  it("deny moves the ask out of pending", async () => {
    const client = createMockAskInboxClient([pendingAsk()]);
    render(<AskInboxPanel client={client} now={() => 1_700_000_030_000} />);
    await waitFor(() => screen.getByTestId("ask-inbox-deny-ask-1"));
    fireEvent.click(screen.getByTestId("ask-inbox-deny-ask-1"));
    await waitFor(() => expect(screen.getByTestId("ask-inbox-history-ask-1")).toHaveTextContent("denied"));
  });

  it("shows the empty state and the morning-brief schedule toggle", async () => {
    render(<AskInboxPanel client={createMockAskInboxClient([])} />);
    await waitFor(() => expect(screen.getByTestId("ask-inbox-empty")).toBeInTheDocument());
    expect(screen.getByTestId("ask-scheduler-morning-brief")).toBeInTheDocument();
    const toggle = screen.getByTestId("ask-scheduler-enabled-morning-brief") as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle.checked).toBe(true));
  });
});
