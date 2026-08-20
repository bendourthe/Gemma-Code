/**
 * v2.0.0 Phase 1 -- vision-chat routing on ChatPage.
 */

import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ChatPage } from "../src/modules/chat/ChatPage";
import { InMemoryChatExplorerClient } from "../src/modules/chat/chatExplorerClient";
import type { ChatSessionClient } from "../src/modules/chat/chatIpcClient";
import type { ListedModelDto } from "../src/pages/settings/modelsTypes";

const VISION: ListedModelDto = {
  id: "gemma-4-12b-it-gguf",
  displayName: "Gemma 4 12B IT GGUF",
  type: "llm",
  installed: true,
  source: "registry",
  modalities: ["text", "image"],
};

const TEXT_ONLY: ListedModelDto = {
  id: "gemma4:e4b",
  displayName: "Gemma 4 E4B",
  type: "llm",
  installed: true,
  source: "registry",
  modalities: ["text"],
};

function png(): File {
  return new File(["x"], "cat.png", { type: "image/png" });
}

describe("ChatPage vision routing", () => {
  it("sends image bytes to the local chat session for a vision model", async () => {
    const client = new InMemoryChatExplorerClient();
    const folder = client.createFolder({ parentId: null, name: "Work" });
    const chat = client.createChat({
      folderId: folder.id,
      title: "draft",
      modelId: VISION.id,
    });
    const sent: Array<{ message: string; images?: readonly string[] }> = [];
    const chatSession: ChatSessionClient = {
      start: async () => ({ sessionId: "s1", modelId: VISION.id, createdAt: "t" }),
      sendMessage: async (input) => {
        sent.push({ message: input.message, images: input.images });
        return {
          sessionId: "s1",
          events: [
            { kind: "token", text: "a tabby cat" },
            { kind: "done", finishReason: "stop" },
          ],
        };
      },
    };
    const user = userEvent.setup();
    render(
      <ChatPage
        client={client}
        chatSession={chatSession}
        modelsClient={{ list: async () => [VISION] }}
      />,
    );
    await user.click(screen.getByTestId(`tree-row-folder-${folder.id}`));
    await user.click(screen.getByTestId(`tree-row-chat-${chat.id}`));
    await waitFor(() =>
      expect(screen.getByTestId("media-composer-add")).toHaveAttribute("data-image-enabled", "true"),
    );
    fireEvent.change(screen.getByTestId("media-composer-file"), { target: { files: [png()] } });
    await waitFor(() => expect(screen.getByTestId("media-composer-thumb-0")).toBeInTheDocument());
    fireEvent.change(screen.getByTestId("media-composer-textarea"), {
      target: { value: "what is this?" },
    });
    fireEvent.click(screen.getByTestId("media-composer-submit"));
    expect(await screen.findByText("a tabby cat")).toBeInTheDocument();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.images?.length).toBe(1);
    expect(sent[0]?.message).toContain("what is this?");
  });

  it("blocks image attach on a text-only model", async () => {
    const client = new InMemoryChatExplorerClient();
    const folder = client.createFolder({ parentId: null, name: "Work" });
    const chat = client.createChat({
      folderId: folder.id,
      title: "draft",
      modelId: TEXT_ONLY.id,
    });
    const user = userEvent.setup();
    render(
      <ChatPage
        client={client}
        chatSession={{
          start: async () => ({ sessionId: "s1", modelId: TEXT_ONLY.id, createdAt: "t" }),
          sendMessage: async () => ({ sessionId: "s1", events: [] }),
        }}
        modelsClient={{ list: async () => [TEXT_ONLY] }}
      />,
    );
    await user.click(screen.getByTestId(`tree-row-folder-${folder.id}`));
    await user.click(screen.getByTestId(`tree-row-chat-${chat.id}`));
    await waitFor(() =>
      expect(screen.getByTestId("media-composer-add")).toHaveAttribute("data-image-enabled", "false"),
    );
    fireEvent.change(screen.getByTestId("media-composer-file"), { target: { files: [png()] } });
    await waitFor(() => expect(screen.queryByTestId("media-composer-thumb-0")).toBeNull());
  });
});
