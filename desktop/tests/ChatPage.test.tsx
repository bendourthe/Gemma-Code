/**
 * v1.0.0 Phase 4.4 -- ChatPage integration tests.
 *
 * Covers: folder-tree + breadcrumb wiring, model selector reuse, the
 * per-folder tools toggle (off by default), end-to-end "create folder
 * - new chat - send message - see assistant echo".
 */

import { describe, it, expect } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatPage } from "../src/modules/chat/ChatPage";
import { InMemoryChatExplorerClient } from "../src/modules/chat/chatExplorerClient";
import type { ChatSessionClient } from "../src/modules/chat/chatIpcClient";

describe("<ChatPage>", () => {
  it("renders the empty-state when no chat is active", () => {
    const client = new InMemoryChatExplorerClient();
    render(<ChatPage client={client} />);
    expect(screen.getByTestId("chat-page-empty")).toBeInTheDocument();
    expect(screen.getByTestId("folder-tree-empty")).toBeInTheDocument();
  });

  it("opening a chat surfaces the message list and input", async () => {
    const client = new InMemoryChatExplorerClient();
    const folder = client.createFolder({ parentId: null, name: "Work" });
    client.createChat({ folderId: folder.id, title: "draft", modelId: "gemma4:e4b" });
    const user = userEvent.setup();
    render(<ChatPage client={client} />);
    // Expand the folder to surface the chat row.
    await user.click(screen.getByTestId(`tree-row-folder-${folder.id}`));
    const chats = client.listTree().children[0]?.chats;
    expect(chats?.length).toBe(1);
    const chatId = chats![0]!.id;
    await user.click(screen.getByTestId(`tree-row-chat-${chatId}`));
    expect(screen.getByTestId("media-composer")).toBeInTheDocument();
    expect(screen.getByTestId("chat-breadcrumb")).toHaveTextContent("Work");
  });

  it("submitting a message renders the user bubble + the streamed assistant reply", async () => {
    const client = new InMemoryChatExplorerClient();
    const folder = client.createFolder({ parentId: null, name: "Work" });
    const chat = client.createChat({ folderId: folder.id, title: "draft", modelId: "gemma4:e4b" });
    const chatSession: ChatSessionClient = {
      start: async () => ({ sessionId: "s1", modelId: "gemma4:e4b", createdAt: "t" }),
      sendMessage: async () => ({
        sessionId: "s1",
        events: [
          { kind: "token", text: "Hi " },
          { kind: "token", text: "there" },
          { kind: "done", finishReason: "stop" },
        ],
      }),
    };
    const user = userEvent.setup();
    render(<ChatPage client={client} chatSession={chatSession} />);
    await user.click(screen.getByTestId(`tree-row-folder-${folder.id}`));
    await user.click(screen.getByTestId(`tree-row-chat-${chat.id}`));
    const textarea = screen.getByTestId("media-composer-textarea");
    await user.type(textarea, "hello{Enter}");
    expect(await screen.findByText("hello")).toBeInTheDocument();
    expect(await screen.findByText("Hi there")).toBeInTheDocument();
  });

  it("shows an inline notice when the chat backend is unavailable", async () => {
    const client = new InMemoryChatExplorerClient();
    const folder = client.createFolder({ parentId: null, name: "Work" });
    const chat = client.createChat({ folderId: folder.id, title: "draft", modelId: "gemma4:e4b" });
    const chatSession: ChatSessionClient = {
      start: async () => {
        throw new Error("ipc-unavailable");
      },
      sendMessage: async () => ({ sessionId: "s1", events: [] }),
    };
    const user = userEvent.setup();
    render(<ChatPage client={client} chatSession={chatSession} />);
    await user.click(screen.getByTestId(`tree-row-folder-${folder.id}`));
    await user.click(screen.getByTestId(`tree-row-chat-${chat.id}`));
    await user.type(screen.getByTestId("media-composer-textarea"), "hello{Enter}");
    expect(await screen.findByText(/chat unavailable/)).toBeInTheDocument();
  });

  it("tools are disabled by default and toggleable per chat", async () => {
    const client = new InMemoryChatExplorerClient();
    const folder = client.createFolder({ parentId: null, name: "Work" });
    client.createChat({ folderId: folder.id, title: "draft", modelId: "gemma4:e4b" });
    render(<ChatPage client={client} />);
    const toggle = screen.getByTestId("chat-enable-tools") as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    fireEvent.click(toggle);
    expect(toggle.checked).toBe(true);
  });

  it("the model selector is disabled while a chat is active", async () => {
    const client = new InMemoryChatExplorerClient();
    const folder = client.createFolder({ parentId: null, name: "Work" });
    const chat = client.createChat({ folderId: folder.id, title: "draft", modelId: "gemma4:e4b" });
    const user = userEvent.setup();
    render(<ChatPage client={client} />);
    expect(screen.getByTestId("chat-model-select")).not.toBeDisabled();
    await user.click(screen.getByTestId(`tree-row-folder-${folder.id}`));
    await user.click(screen.getByTestId(`tree-row-chat-${chat.id}`));
    expect(screen.getByTestId("chat-model-select")).toBeDisabled();
  });

  it("breadcrumb shows ancestor chain for nested chats", async () => {
    const client = new InMemoryChatExplorerClient();
    const projects = client.createFolder({ parentId: null, name: "Projects" });
    const work = client.createFolder({ parentId: projects.id, name: "Work" });
    const q3 = client.createFolder({ parentId: work.id, name: "Q3" });
    const chat = client.createChat({ folderId: q3.id, title: "kickoff", modelId: "m" });
    const user = userEvent.setup();
    render(<ChatPage client={client} />);
    // Expand the chain manually.
    await user.click(screen.getByTestId(`tree-row-folder-${projects.id}`));
    await user.click(screen.getByTestId(`tree-row-folder-${work.id}`));
    await user.click(screen.getByTestId(`tree-row-folder-${q3.id}`));
    await user.click(screen.getByTestId(`tree-row-chat-${chat.id}`));
    const crumb = screen.getByTestId("chat-breadcrumb");
    expect(crumb).toHaveTextContent("Projects");
    expect(crumb).toHaveTextContent("Work");
    expect(crumb).toHaveTextContent("Q3");
  });

  it("the compact switcher lists only installed LLMs from the models client", async () => {
    const client = new InMemoryChatExplorerClient();
    const modelsClient = {
      async list() {
        return [
          {
            id: "gemma4:e4b",
            displayName: "Gemma 4 E4B",
            type: "llm" as const,
            installed: true,
            source: "registry" as const,
          },
          {
            id: "catalog-llm",
            displayName: "Not Installed",
            type: "llm" as const,
            installed: false,
            source: "catalog-only" as const,
          },
          {
            id: "sana",
            displayName: "SANA",
            type: "image" as const,
            installed: true,
            source: "registry" as const,
          },
        ];
      },
    };
    render(<ChatPage client={client} modelsClient={modelsClient} />);
    const select = await screen.findByTestId("chat-model-select") as HTMLSelectElement;
    await waitFor(() => {
      const values = [...select.options].map((o) => o.value);
      expect(values).toEqual(["gemma4:e4b", "__get_more_models__"]);
    });
  });
});
