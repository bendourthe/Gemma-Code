/**
 * v1.5.0 Phase 5 (adoption-ecosystem-2026-06 T016) -- ChatPage preview-pane
 * integration: selecting a message opens its output beside the active chat.
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatPage } from "../src/modules/chat/ChatPage";
import { InMemoryChatExplorerClient } from "../src/modules/chat/chatExplorerClient";

async function openChatAndSend(): Promise<void> {
  const client = new InMemoryChatExplorerClient();
  const folder = client.createFolder({ parentId: null, name: "Work" });
  const chat = client.createChat({
    folderId: folder.id,
    title: "draft",
    modelId: "gemma4:e4b",
  });
  const user = userEvent.setup();
  render(<ChatPage client={client} />);
  await user.click(screen.getByTestId(`tree-row-folder-${folder.id}`));
  await user.click(screen.getByTestId(`tree-row-chat-${chat.id}`));
  const textarea = screen.getByTestId("chat-input-textarea");
  await user.type(textarea, "hello{Enter}");
}

describe("<ChatPage> preview pane", () => {
  it("is closed until a message is selected", async () => {
    await openChatAndSend();
    expect(screen.queryByTestId("preview-pane")).not.toBeInTheDocument();
  });

  it("renders the selected message output beside the chat", async () => {
    await openChatAndSend();
    const user = userEvent.setup();
    // Click the assistant echo bubble to open it in the preview pane.
    const assistant = screen.getByText(/Echo of your message/);
    await user.click(assistant);

    const pane = screen.getByTestId("preview-pane");
    expect(pane).toBeInTheDocument();
    // Both the message list and the preview pane are mounted side-by-side.
    expect(screen.getByTestId("message-list")).toBeInTheDocument();
    expect(screen.getByTestId("preview-pane-text")).toHaveTextContent(
      "Echo of your message",
    );
  });

  it("closes the pane when the close button is clicked", async () => {
    await openChatAndSend();
    const user = userEvent.setup();
    await user.click(screen.getByText(/Echo of your message/));
    expect(screen.getByTestId("preview-pane")).toBeInTheDocument();
    await user.click(screen.getByTestId("preview-pane-close"));
    expect(screen.queryByTestId("preview-pane")).not.toBeInTheDocument();
  });
});
