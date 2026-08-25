import { readFileSync } from "node:fs";
import * as path from "node:path";

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ChatPage } from "../src/modules/chat/ChatPage";
import { InMemoryChatExplorerClient } from "../src/modules/chat/chatExplorerClient";
import type { ChatSessionClient } from "../src/modules/chat/chatIpcClient";
import type { AppendMessageInput, ChatMessageRecord } from "../src/modules/chat/types";
import { INSTALLED_CHAT_MODELS, waitForInstalledChatModel } from "./installedChatModels";

class PersistentExplorerClient extends InMemoryChatExplorerClient {
  private readonly messages = new Map<string, ChatMessageRecord[]>();
  private nextMessage = 0;

  readonly appendMessage = vi.fn((input: AppendMessageInput): ChatMessageRecord => {
    const record: ChatMessageRecord = {
      id: input.id ?? `stored-${++this.nextMessage}`,
      chatId: input.chatId,
      role: input.role,
      content: input.content,
      attachments: input.attachments ?? [],
      createdAt: input.createdAt ?? Date.now(),
    };
    this.messages.set(input.chatId, [...(this.messages.get(input.chatId) ?? []), record]);
    return record;
  });

  readonly listMessages = vi.fn(
    (chatId: string, limit = 500): readonly ChatMessageRecord[] =>
      (this.messages.get(chatId) ?? []).slice(-limit),
  );

  seed(record: ChatMessageRecord): void {
    this.messages.set(record.chatId, [...(this.messages.get(record.chatId) ?? []), record]);
  }
}

function successfulSession(overrides: Partial<ChatSessionClient> = {}): ChatSessionClient {
  return {
    start: async () => ({ sessionId: "session-1", modelId: "gemma4:e4b", createdAt: "t" }),
    sendMessage: async (input) => ({
      sessionId: input.sessionId,
      events: [
        { kind: "token", text: "Persisted reply" },
        { kind: "done", finishReason: "stop" },
      ],
    }),
    ...overrides,
  };
}

async function openChat(
  user: ReturnType<typeof userEvent.setup>,
  folderId: string,
  chatId: string,
): Promise<void> {
  const chatTestId = `tree-row-chat-${chatId}`;
  if (!screen.queryByTestId(chatTestId)) {
    await user.click(screen.getByTestId(`tree-row-folder-${folderId}`));
  }
  await user.click(await screen.findByTestId(chatTestId));
}

describe("<ChatPage> transcript durability", () => {
  it("hydrates only the opened chat and survives a component remount", async () => {
    const client = new PersistentExplorerClient();
    const folder = client.createFolder({ parentId: null, name: "Saved" });
    const chatA = client.createChat({ folderId: folder.id, title: "A", modelId: "gemma4:e4b" });
    const chatB = client.createChat({ folderId: folder.id, title: "B", modelId: "gemma4:e4b" });
    client.seed({
      id: "a1",
      chatId: chatA.id,
      role: "user",
      content: "chat A only",
      attachments: [],
      createdAt: 1,
    });
    client.seed({
      id: "b1",
      chatId: chatB.id,
      role: "assistant",
      content: "restored chat B",
      attachments: [],
      createdAt: 2,
    });
    const user = userEvent.setup();
    const first = render(<ChatPage client={client} modelsClient={INSTALLED_CHAT_MODELS} />);
    await openChat(user, folder.id, chatB.id);
    expect(await screen.findByText("restored chat B")).toBeInTheDocument();
    expect(screen.queryByText("chat A only")).toBeNull();
    first.unmount();

    render(<ChatPage client={client} />);
    await openChat(user, folder.id, chatB.id);
    expect(await screen.findByText("restored chat B")).toBeInTheDocument();
    expect(client.listMessages).toHaveBeenCalledWith(chatB.id, 500);
  });

  it("persists the user row and finalized assistant row after local append", async () => {
    const client = new PersistentExplorerClient();
    const folder = client.createFolder({ parentId: null, name: "Saved" });
    const chat = client.createChat({ folderId: folder.id, title: "Thread", modelId: "gemma4:e4b" });
    const user = userEvent.setup();
    render(<ChatPage client={client} chatSession={successfulSession()} modelsClient={INSTALLED_CHAT_MODELS} />);
    await openChat(user, folder.id, chat.id);
    await waitForInstalledChatModel();
    await user.type(screen.getByTestId("media-composer-textarea"), "remember this{Enter}");
    expect(await screen.findByText("Persisted reply")).toBeInTheDocument();
    await waitFor(() => expect(client.appendMessage).toHaveBeenCalledTimes(2));
    expect(client.appendMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ chatId: chat.id, role: "user", content: "remember this" }),
    );
    expect(client.appendMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ chatId: chat.id, role: "assistant", content: "Persisted reply" }),
    );
  });

  it("remounts the same chat with both the user prompt and assistant reply", async () => {
    const client = new PersistentExplorerClient();
    const folder = client.createFolder({ parentId: null, name: "Saved" });
    const chat = client.createChat({ folderId: folder.id, title: "Thread", modelId: "gemma4:e4b" });
    const user = userEvent.setup();
    const first = render(
      <ChatPage client={client} chatSession={successfulSession()} modelsClient={INSTALLED_CHAT_MODELS} />,
    );
    await openChat(user, folder.id, chat.id);
    await waitForInstalledChatModel();
    await user.type(screen.getByTestId("media-composer-textarea"), "remember this{Enter}");
    expect(await screen.findByText("remember this")).toBeInTheDocument();
    expect(await screen.findByText("Persisted reply")).toBeInTheDocument();
    first.unmount();

    render(<ChatPage client={client} modelsClient={INSTALLED_CHAT_MODELS} />);
    await openChat(user, folder.id, chat.id);
    expect(await screen.findByText("remember this")).toBeInTheDocument();
    expect(await screen.findByText("Persisted reply")).toBeInTheDocument();
  });

  it("hydrates stored image attachments after remount", async () => {
    const client = new PersistentExplorerClient();
    const folder = client.createFolder({ parentId: null, name: "Saved" });
    const chat = client.createChat({ folderId: folder.id, title: "Thread", modelId: "gemma4:e4b" });
    client.seed({
      id: "img-1",
      chatId: chat.id,
      role: "user",
      content: "see this",
      attachments: ["data:image/png;base64,AAAA"],
      createdAt: 1,
    });
    const user = userEvent.setup();
    const first = render(<ChatPage client={client} modelsClient={INSTALLED_CHAT_MODELS} />);
    await openChat(user, folder.id, chat.id);
    expect(await screen.findByTestId("message-attachment-img-1-0")).toHaveAttribute(
      "src",
      "data:image/png;base64,AAAA",
    );
    first.unmount();

    render(<ChatPage client={client} modelsClient={INSTALLED_CHAT_MODELS} />);
    await openChat(user, folder.id, chat.id);
    expect(await screen.findByTestId("message-attachment-img-1-0")).toHaveAttribute(
      "src",
      "data:image/png;base64,AAAA",
    );
  });

  it("does not claim a durable save when appendMessage fails", async () => {
    const client = new PersistentExplorerClient();
    const folder = client.createFolder({ parentId: null, name: "Saved" });
    const chat = client.createChat({ folderId: folder.id, title: "Thread", modelId: "gemma4:e4b" });
    client.appendMessage.mockImplementation(() => {
      throw new Error("disk full");
    });
    const user = userEvent.setup();
    render(
      <ChatPage client={client} chatSession={successfulSession()} modelsClient={INSTALLED_CHAT_MODELS} />,
    );
    await openChat(user, folder.id, chat.id);
    await waitForInstalledChatModel();
    await user.type(screen.getByTestId("media-composer-textarea"), "keep locally{Enter}");
    expect(await screen.findByText("keep locally")).toBeInTheDocument();
    expect(await screen.findByTestId("chat-transcript-error")).toHaveTextContent(
      "Message is visible but was not saved",
    );
  });

  it("replays stored turns when starting a new model session", async () => {
    const client = new PersistentExplorerClient();
    const folder = client.createFolder({ parentId: null, name: "Saved" });
    const chat = client.createChat({ folderId: folder.id, title: "Thread", modelId: "gemma4:e4b" });
    client.seed({ id: "u1", chatId: chat.id, role: "user", content: "old question", attachments: [], createdAt: 1 });
    client.seed({ id: "a1", chatId: chat.id, role: "assistant", content: "old answer", attachments: [], createdAt: 2 });
    const start = vi.fn(successfulSession().start);
    const user = userEvent.setup();
    render(<ChatPage client={client} chatSession={successfulSession({ start })} modelsClient={INSTALLED_CHAT_MODELS} />);
    await openChat(user, folder.id, chat.id);
    await screen.findByText("old answer");
    await waitForInstalledChatModel();
    await user.type(screen.getByTestId("media-composer-textarea"), "new question{Enter}");
    await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
    expect(start.mock.calls[0]?.[0].history).toEqual([
      { role: "user", content: "old question" },
      { role: "assistant", content: "old answer" },
    ]);
  });

  it("restarts with replayed history after the sidecar forgets a session", async () => {
    const client = new PersistentExplorerClient();
    const folder = client.createFolder({ parentId: null, name: "Saved" });
    const chat = client.createChat({ folderId: folder.id, title: "Thread", modelId: "gemma4:e4b" });
    const start = vi
      .fn<ChatSessionClient["start"]>()
      .mockResolvedValueOnce({ sessionId: "stale", modelId: "gemma4:e4b", createdAt: "t1" })
      .mockResolvedValueOnce({ sessionId: "fresh", modelId: "gemma4:e4b", createdAt: "t2" });
    const sendMessage = vi
      .fn<ChatSessionClient["sendMessage"]>()
      .mockRejectedValueOnce(new Error("unknown sessionId: stale"))
      .mockResolvedValueOnce({
        sessionId: "fresh",
        events: [{ kind: "token", text: "Recovered" }, { kind: "done", finishReason: "stop" }],
      });
    const user = userEvent.setup();
    render(<ChatPage client={client} chatSession={{ start, sendMessage }} modelsClient={INSTALLED_CHAT_MODELS} />);
    await openChat(user, folder.id, chat.id);
    await waitForInstalledChatModel();
    await user.type(screen.getByTestId("media-composer-textarea"), "hello{Enter}");
    expect(await screen.findByText("Recovered")).toBeInTheDocument();
    expect(start).toHaveBeenCalledTimes(2);
    expect(sendMessage.mock.calls.map(([input]) => input.sessionId)).toEqual(["stale", "fresh"]);
  });

  it("keeps the composer available and reports a hydration failure", async () => {
    const client = new PersistentExplorerClient();
    const folder = client.createFolder({ parentId: null, name: "Saved" });
    const chat = client.createChat({ folderId: folder.id, title: "Thread", modelId: "gemma4:e4b" });
    client.listMessages.mockRejectedValueOnce(new Error("db locked"));
    const user = userEvent.setup();
    render(<ChatPage client={client} />);
    await openChat(user, folder.id, chat.id);
    expect(await screen.findByTestId("chat-transcript-error")).toHaveTextContent("db locked");
    expect(screen.getByTestId("media-composer")).toBeInTheDocument();
  });

  it("uses the production IPC memory factory instead of an in-memory-only hub", () => {
    const source = readFileSync(path.resolve(__dirname, "../src/App.tsx"), "utf8");
    expect(source).toContain("createIpcChatMemoryHub");
    expect(source).not.toContain("new InMemoryMemoryHub()");
  });
});
