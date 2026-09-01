/**
 * v2.4.1 Phase 5 -- ordinary transcript text remains in the conversation.
 * Media retains its own focused preview, but text no longer opens a side pane.
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatPage } from "../src/modules/chat/ChatPage";
import { InMemoryChatExplorerClient } from "../src/modules/chat/chatExplorerClient";
import type { ChatSessionClient } from "../src/modules/chat/chatIpcClient";
import { INSTALLED_CHAT_MODELS, waitForInstalledChatModel } from "./installedChatModels";

const REPLY = "Assistant reply text";

async function openChatAndSend(): Promise<void> {
  const client = new InMemoryChatExplorerClient();
  const folder = client.createFolder({ parentId: null, name: "Work" });
  const chat = client.createChat({
    folderId: folder.id,
    title: "draft",
    modelId: "gemma4:e4b",
  });
  const chatSession: ChatSessionClient = {
    start: async () => ({ sessionId: "s1", modelId: "gemma4:e4b", createdAt: "t" }),
    sendMessage: async () => ({
      sessionId: "s1",
      events: [
        { kind: "token", text: REPLY },
        { kind: "done", finishReason: "stop" },
      ],
    }),
  };
  const user = userEvent.setup();
  render(<ChatPage client={client} chatSession={chatSession} modelsClient={INSTALLED_CHAT_MODELS} />);
  await user.click(screen.getByTestId(`tree-row-folder-${folder.id}`));
  await user.click(screen.getByTestId(`tree-row-chat-${chat.id}`));
  await waitForInstalledChatModel();
  const textarea = screen.getByTestId("media-composer-textarea");
  await user.type(textarea, "hello{Enter}");
  await screen.findByText(REPLY); // wait for the async assistant reply to render
}

describe("<ChatPage> text messages", () => {
  it("does not mount a generic preview pane", async () => {
    await openChatAndSend();
    expect(screen.queryByTestId("preview-pane")).not.toBeInTheDocument();
  });

  it("keeps the transcript unchanged when assistant text is clicked", async () => {
    await openChatAndSend();
    const user = userEvent.setup();
    const assistant = screen.getByText(REPLY);
    await user.click(assistant);
    expect(screen.getByTestId("message-list")).toBeInTheDocument();
    expect(screen.queryByTestId("preview-pane")).not.toBeInTheDocument();
    expect(assistant.closest("article")).not.toHaveAttribute("role", "button");
  });
});
