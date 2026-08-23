/**
 * v1.0.0 Phase 4.4 -- ChatPage integration tests.
 *
 * Covers: folder-tree + breadcrumb wiring, model selector reuse, tools
 * always on (no per-chat checkbox), end-to-end "create folder - new chat
 * - send message - see assistant echo", and the v2.2.4 honesty contract
 * (Hi user bubble + send id equals the visible installed model).
 */

import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatPage } from "../src/modules/chat/ChatPage";
import { InMemoryChatExplorerClient } from "../src/modules/chat/chatExplorerClient";
import type { ChatSessionClient } from "../src/modules/chat/chatIpcClient";

const INSTALLED_CHAT_MODELS = {
  async list() {
    return [
      {
        id: "gemma4:e4b",
        displayName: "Gemma 4 E4B",
        type: "llm" as const,
        installed: true,
        source: "registry" as const,
      },
    ];
  },
};

describe("<ChatPage>", () => {
  it("renders the empty-state when no chat is active", () => {
    const client = new InMemoryChatExplorerClient();
    render(<ChatPage client={client} />);
    expect(screen.getByTestId("chat-page-empty")).toBeInTheDocument();
    expect(screen.getByTestId("folder-tree-empty")).toBeInTheDocument();
    expect(screen.getByTestId("media-composer")).toBeInTheDocument();
  });

  it("sends from the composer without a folder or existing chat", async () => {
    const client = new InMemoryChatExplorerClient();
    const chatSession: ChatSessionClient = {
      start: async () => ({ sessionId: "s1", modelId: "gemma4:e4b", createdAt: "t" }),
      sendMessage: async () => ({
        sessionId: "s1",
        events: [
          { kind: "token", text: "ok" },
          { kind: "done", finishReason: "stop" },
        ],
      }),
    };
    const user = userEvent.setup();
    render(<ChatPage client={client} chatSession={chatSession} modelsClient={INSTALLED_CHAT_MODELS} />);
    const textarea = screen.getByTestId("media-composer-textarea");
    await user.type(textarea, "hello from an empty rail{Enter}");
    expect(await screen.findByText("hello from an empty rail")).toBeInTheDocument();
    expect(client.listTree().chats.length).toBe(1);
    expect(client.listTree().chats[0]?.title).toBe("New chat");
  });

  it("does not send until a conflicting active model switch is approved", async () => {
    const client = new InMemoryChatExplorerClient();
    const start = vi.fn(async () => ({ sessionId: "s1", modelId: "gemma4:e4b", createdAt: "t" }));
    const sendMessage = vi.fn(async () => ({
      sessionId: "s1",
      events: [
        { kind: "token" as const, text: "ok" },
        { kind: "done" as const, finishReason: "stop" },
      ],
    }));
    const user = userEvent.setup();
    render(
      <ChatPage
        client={client}
        chatSession={{ start, sendMessage }}
        modelsClient={INSTALLED_CHAT_MODELS}
        hostVramFreeGB={1}
        activeSchedulerJob={{
          id: "image-job",
          moduleId: "image",
          jobType: "txt2img",
          modelId: "sana-1.6b-1024",
          estimatedVramGB: 3.2,
          startedAt: 1,
        }}
      />,
    );
    await user.type(screen.getByTestId("media-composer-textarea"), "hello{Enter}");
    expect(await screen.findByTestId("chat-model-switch-dialog")).toBeInTheDocument();
    expect(start).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
    await user.click(screen.getByTestId("chat-model-switch-dialog-switch"));
    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("ok")).toBeInTheDocument();
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
    render(<ChatPage client={client} chatSession={chatSession} modelsClient={INSTALLED_CHAT_MODELS} />);
    await user.click(screen.getByTestId(`tree-row-folder-${folder.id}`));
    await user.click(screen.getByTestId(`tree-row-chat-${chat.id}`));
    const textarea = screen.getByTestId("media-composer-textarea");
    await user.type(textarea, "hello{Enter}");
    expect(await screen.findByText("hello")).toBeInTheDocument();
    expect(await screen.findByText("Hi there")).toBeInTheDocument();
  });

  it("prepends the per-chat persona onto the outbound message", async () => {
    const client = new InMemoryChatExplorerClient();
    const folder = client.createFolder({ parentId: null, name: "Work" });
    const chat = client.createChat({ folderId: folder.id, title: "draft", modelId: "gemma4:e4b" });
    const sent: string[] = [];
    const chatSession: ChatSessionClient = {
      start: async () => ({ sessionId: "s1", modelId: "gemma4:e4b", createdAt: "t" }),
      sendMessage: async (input) => {
        sent.push(input.message);
        return {
          sessionId: "s1",
          events: [{ kind: "token", text: "ok" }, { kind: "done", finishReason: "stop" }],
        };
      },
    };
    const user = userEvent.setup();
    render(<ChatPage client={client} chatSession={chatSession} modelsClient={INSTALLED_CHAT_MODELS} />);
    await user.click(screen.getByTestId(`tree-row-folder-${folder.id}`));
    await user.click(screen.getByTestId(`tree-row-chat-${chat.id}`));
    // v2.2.0 Phase 5 (5.4): the persona left the always-on textarea under the
    // composer and now lives behind the chat header's settings gear.
    await user.click(screen.getByTestId("chat-persona-toggle"));
    fireEvent.change(screen.getByTestId("chat-persona"), { target: { value: "Be terse." } });
    fireEvent.change(screen.getByTestId("media-composer-textarea"), { target: { value: "hello" } });
    fireEvent.click(screen.getByTestId("media-composer-submit"));
    await waitFor(() => expect(sent[0]).toContain("[Persona]"));
    expect(sent[0]).toContain("Be terse.");
    expect(sent[0]).toContain("hello");
  });

  it("shows the composing orb while the assistant reply is in flight", async () => {
    const client = new InMemoryChatExplorerClient();
    const folder = client.createFolder({ parentId: null, name: "Work" });
    const chat = client.createChat({ folderId: folder.id, title: "draft", modelId: "gemma4:e4b" });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chatSession: ChatSessionClient = {
      start: async () => ({ sessionId: "s1", modelId: "gemma4:e4b", createdAt: "t" }),
      sendMessage: async () => {
        await gate;
        return {
          sessionId: "s1",
          events: [
            { kind: "token", text: "Hi " },
            { kind: "token", text: "there" },
            { kind: "done", finishReason: "stop" },
          ],
        };
      },
    };
    const user = userEvent.setup();
    render(<ChatPage client={client} chatSession={chatSession} modelsClient={INSTALLED_CHAT_MODELS} />);
    await user.click(screen.getByTestId(`tree-row-folder-${folder.id}`));
    await user.click(screen.getByTestId(`tree-row-chat-${chat.id}`));
    await user.type(screen.getByTestId("media-composer-textarea"), "hello{Enter}");
    const orb = await screen.findByRole("img", { name: /agent composing/i });
    expect(orb).toHaveAttribute("data-agent-activity", "chat-streaming");
    expect(screen.getByText("Composing...")).toBeInTheDocument();
    expect(screen.queryByText("Generating...")).toBeNull();
    expect(screen.getByTestId("media-composer-beam")).toHaveAttribute("data-beam-mode", "traveling");
    expect(screen.getByTestId("media-composer-beam")).toHaveAttribute("data-beam-playing", "true");
    release();
    expect(await screen.findByText("Hi there")).toBeInTheDocument();
    expect(screen.queryByTestId(/message-pending-/)).toBeNull();
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
    render(<ChatPage client={client} chatSession={chatSession} modelsClient={INSTALLED_CHAT_MODELS} />);
    await user.click(screen.getByTestId(`tree-row-folder-${folder.id}`));
    await user.click(screen.getByTestId(`tree-row-chat-${chat.id}`));
    await user.type(screen.getByTestId("media-composer-textarea"), "hello{Enter}");
    expect(await screen.findByText(/chat unavailable/)).toBeInTheDocument();
  });

  it("does not render an Enable tools checkbox because tools stay on", () => {
    const client = new InMemoryChatExplorerClient();
    client.createFolder({ parentId: null, name: "Work" });
    render(<ChatPage client={client} />);
    expect(screen.queryByTestId("chat-enable-tools")).toBeNull();
  });

  it("shows the Hi user bubble and sends the visible installed model, not gemma4:e4b", async () => {
    const client = new InMemoryChatExplorerClient();
    const start = vi.fn(async () => ({ sessionId: "s-lfm", modelId: "lfm2.5:1.2b", createdAt: "t" }));
    const sendMessage = vi.fn(async () => ({
      sessionId: "s-lfm",
      events: [
        { kind: "token" as const, text: "hello" },
        { kind: "done" as const, finishReason: "stop" },
      ],
    }));
    const modelsClient = {
      lastSelection: {
        schemaVersion: 1 as const,
        orderedIds: ["lfm2.5:1.2b"],
        recommendedByTask: { chat: "lfm2.5:1.2b" },
        downloadedSinceInstall: [],
      },
      async list() {
        return [
          {
            id: "lfm2.5:1.2b",
            displayName: "LFM 2.5 1.2B",
            type: "llm" as const,
            installed: true,
            source: "registry" as const,
          },
        ];
      },
    };
    const user = userEvent.setup();
    render(
      <ChatPage
        client={client}
        chatSession={{ start, sendMessage }}
        modelsClient={modelsClient}
      />,
    );
    await waitFor(() => {
      expect((screen.getByTestId("chat-model-select") as HTMLSelectElement).value).toBe(
        "lfm2.5:1.2b",
      );
    });
    await user.type(screen.getByTestId("media-composer-textarea"), "Hi{Enter}");
    expect(await screen.findByText("Hi")).toBeInTheDocument();
    await waitFor(() => {
      expect(start).toHaveBeenCalled();
    });
    expect(start.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ modelId: "lfm2.5:1.2b" }));
  });

  it("keeps the Hi user bubble when the selected model is not installed", async () => {
    const client = new InMemoryChatExplorerClient();
    const start = vi.fn();
    const user = userEvent.setup();
    render(
      <ChatPage
        client={client}
        chatSession={{ start, sendMessage: vi.fn() }}
        modelsClient={{ async list() { return []; } }}
      />,
    );
    await user.type(screen.getByTestId("media-composer-textarea"), "Hi{Enter}");
    expect(await screen.findByText("Hi")).toBeInTheDocument();
    expect(await screen.findByText(/is not installed/i)).toBeInTheDocument();
    expect(start).not.toHaveBeenCalled();
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

  it("shows SidecarDownBanner when the sidecar is down and keeps the composer", async () => {
    const client = new InMemoryChatExplorerClient();
    render(
      <ChatPage
        client={client}
        sidecarStatus={{
          pollMs: 0,
          debounceMs: 1,
          fetchFn: async () => ({
            running: false,
            nodePath: "C:/Nexus/runtime/node/node.exe",
            nodeSource: "runtime-config",
            scriptPath: "C:/Nexus/sidecar/dist/main.js",
            failure: "sidecar-exited:-1073741510",
            stderrTail: [],
            candidatesRejected: [],
          }),
        }}
      />,
    );
    expect(await screen.findByTestId("chat-sidecar-down")).toBeInTheDocument();
    expect(screen.getByTestId("media-composer")).toBeInTheDocument();
  });
});
