/**
 * v2.2.3 Phase 1 (1.1) -- promise-safe explorer adapter tests.
 *
 * The P0 behind U7: ChatPage cast the async IPC client onto the sync
 * `ChatExplorerClient`, so FolderTree's `listTree()` (and ChatPage's
 * `ancestors()`) threw in useMemo and blanked the whole app. These tests run
 * FolderTree/ChatPage against an IPC-SHAPED fake -- async `tree()`, no
 * `listTree`, no `search` -- wrapped in the production adapter, and prove the
 * old cast is gone from ChatPage source.
 */

import { readFileSync } from "node:fs";
import * as path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FolderTree } from "../src/modules/chat/FolderTree";
import { ChatPage } from "../src/modules/chat/ChatPage";
import { ModuleErrorBoundary } from "../src/components/ModuleErrorBoundary";
import {
  createExplorerAdapter,
  type IpcChatExplorerClient,
} from "../src/modules/chat/ipcChatExplorerClient";
import type {
  Chat,
  ChatMessageRecord,
  Folder,
  FolderTreeNode,
} from "../src/modules/chat/types";

/**
 * An IPC-shaped fake: every method is async, the tree read is `tree()` (NOT
 * `listTree`), `createFolder` takes positional args, and `search` is absent.
 */
function createIpcShapedFake(): {
  fake: IpcChatExplorerClient;
  folders: Map<string, Folder>;
  chats: Map<string, Chat>;
} {
  const folders = new Map<string, Folder>();
  const chats = new Map<string, Chat>();
  let counter = 0;
  const nextId = (prefix: string): string => `${prefix}-${(counter += 1)}`;

  const buildTree = (parent: Folder | null): FolderTreeNode => {
    const parentId = parent?.id ?? null;
    return {
      folder: parent,
      children: [...folders.values()]
        .filter((f) => f.parentId === parentId)
        .map((f) => buildTree(f)),
      chats: [...chats.values()].filter((c) => c.folderId === parentId),
    };
  };

  const fake: IpcChatExplorerClient = {
    tree: async () => buildTree(null),
    createFolder: async (parentId, name) => {
      const now = Date.now();
      const folder: Folder = {
        id: nextId("folder"),
        parentId,
        name,
        createdAt: now,
        updatedAt: now,
      };
      folders.set(folder.id, folder);
      return folder;
    },
    renameFolder: async (id, name) => {
      const folder = folders.get(id);
      if (!folder) throw new Error(`folder not found: ${id}`);
      const updated: Folder = { ...folder, name, updatedAt: Date.now() };
      folders.set(id, updated);
      return updated;
    },
    moveFolder: async (id, parentId) => {
      const folder = folders.get(id);
      if (!folder) throw new Error(`folder not found: ${id}`);
      const updated: Folder = { ...folder, parentId, updatedAt: Date.now() };
      folders.set(id, updated);
      return updated;
    },
    deleteFolder: async (id) => {
      folders.delete(id);
    },
    createChat: async (folderIdOrInput, title, modelId) => {
      const input =
        folderIdOrInput !== null && typeof folderIdOrInput === "object"
          ? folderIdOrInput
          : { folderId: folderIdOrInput, title: title ?? "", modelId: modelId ?? "" };
      const now = Date.now();
      const chat: Chat = {
        id: nextId("chat"),
        folderId: input.folderId,
        title: input.title,
        modelId: input.modelId,
        contextScopeId: input.folderId,
        createdAt: now,
        updatedAt: now,
        messageCount: 0,
      };
      chats.set(chat.id, chat);
      return chat;
    },
    renameChat: async (id, title) => {
      const chat = chats.get(id);
      if (!chat) throw new Error(`chat not found: ${id}`);
      const updated: Chat = { ...chat, title, updatedAt: Date.now() };
      chats.set(id, updated);
      return updated;
    },
    moveChat: async (id, folderId) => {
      const chat = chats.get(id);
      if (!chat) throw new Error(`chat not found: ${id}`);
      const updated: Chat = { ...chat, folderId, updatedAt: Date.now() };
      chats.set(id, updated);
      return updated;
    },
    deleteChat: async (id) => {
      chats.delete(id);
    },
    setPersona: async () => undefined,
    appendMessage: async (input) => {
      const record: ChatMessageRecord = {
        id: nextId("msg"),
        chatId: input.chatId,
        role: input.role,
        content: input.content,
        attachments: input.attachments ?? [],
        createdAt: Date.now(),
      };
      return record;
    },
    listMessages: async () => [],
    generateTitle: async () => ({ title: "Generated", source: "test" }),
  };

  return { fake, folders, chats };
}

describe("createExplorerAdapter", () => {
  it("exposes listTree as an alias of the IPC tree()", async () => {
    const { fake, folders } = createIpcShapedFake();
    await fake.createFolder(null, "Work");
    const adapter = createExplorerAdapter(fake);
    const tree = await adapter.listTree();
    expect(tree.children.map((c) => c.folder?.name)).toEqual(["Work"]);
    expect(folders.size).toBe(1);
  });

  it("maps the object-form createFolder onto positional IPC args", async () => {
    const { fake } = createIpcShapedFake();
    const treeSpy = vi.spyOn(fake, "createFolder");
    const adapter = createExplorerAdapter(fake);
    const folder = await Promise.resolve(adapter.createFolder({ parentId: null, name: "Inbox" }));
    expect(treeSpy).toHaveBeenCalledWith(null, "Inbox");
    expect(folder.name).toBe("Inbox");
  });

  it("resolves getFolder/getChat/ancestors against a cached tree that refreshes after mutations", async () => {
    const { fake } = createIpcShapedFake();
    const parent = await fake.createFolder(null, "Parent");
    const child = await fake.createFolder(parent.id, "Child");
    const chat = await fake.createChat({ folderId: child.id, title: "Draft", modelId: "m" });
    const adapter = createExplorerAdapter(fake);

    expect((await Promise.resolve(adapter.getFolder(child.id)))?.name).toBe("Child");
    expect((await Promise.resolve(adapter.getChat(chat.id)))?.title).toBe("Draft");
    const chain = await Promise.resolve(adapter.ancestors(child.id));
    expect(chain.map((f) => f.name)).toEqual(["Parent", "Child"]);
    expect(await Promise.resolve(adapter.ancestors(null))).toEqual([]);

    // A mutation invalidates the cache, so the next read sees the new row.
    const created = await Promise.resolve(
      adapter.createChat({ folderId: null, title: "Fresh", modelId: "m" }),
    );
    expect((await Promise.resolve(adapter.getChat(created.id)))?.title).toBe("Fresh");
  });

  it("falls back to cached-tree search when the raw client has no search", async () => {
    const { fake } = createIpcShapedFake();
    await fake.createFolder(null, "Research");
    await fake.createChat({ folderId: null, title: "research notes", modelId: "m" });
    const adapter = createExplorerAdapter(fake);
    const hits = await Promise.resolve(adapter.search("research"));
    expect(hits.map((h) => `${h.kind}:${h.name}`)).toEqual([
      "folder:Research",
      "chat:research notes",
    ]);
  });

  it("delegates search to the raw client when it exposes one (sidecar chat.explorer.search)", async () => {
    const { fake } = createIpcShapedFake();
    const delegated = vi.fn(async () => [
      { kind: "chat" as const, id: "c1", name: "hit", parentId: null },
    ]);
    fake.search = delegated;
    const adapter = createExplorerAdapter(fake);
    const hits = await Promise.resolve(adapter.search("hit", 5));
    expect(delegated).toHaveBeenCalledWith("hit", 5);
    expect(hits[0]?.name).toBe("hit");
  });
});

describe("<FolderTree> with an async IPC-shaped client", () => {
  const storageAdapter = (() => {
    let ids: readonly string[] = [];
    return {
      read: () => ids,
      write: (next: readonly string[]) => {
        ids = next;
      },
    };
  })();

  it("renders the tree from the async adapter instead of throwing (P0, U7)", async () => {
    const { fake } = createIpcShapedFake();
    const folder = await fake.createFolder(null, "Work");
    await fake.createChat({ folderId: null, title: "Loose chat", modelId: "m" });
    const adapter = createExplorerAdapter(fake);
    render(<FolderTree client={adapter} storageAdapter={storageAdapter} />);
    expect(await screen.findByTestId(`tree-row-folder-${folder.id}`)).toBeInTheDocument();
    expect(screen.getByText("Loose chat")).toBeInTheDocument();
    expect(screen.queryByTestId("folder-tree-error")).toBeNull();
  });

  it("degrades a failed tree load to an empty tree plus a one-line error", async () => {
    const { fake } = createIpcShapedFake();
    fake.tree = async () => {
      throw new Error("malformed IPC payload");
    };
    const adapter = createExplorerAdapter(fake);
    render(<FolderTree client={adapter} storageAdapter={storageAdapter} />);
    expect(await screen.findByTestId("folder-tree-error")).toHaveTextContent(
      "malformed IPC payload",
    );
    expect(screen.getByTestId("folder-tree-empty")).toBeInTheDocument();
  });

  it("creates a chat through the async adapter from the empty-state CTA", async () => {
    const { fake, chats } = createIpcShapedFake();
    const adapter = createExplorerAdapter(fake);
    const user = userEvent.setup();
    render(<FolderTree client={adapter} storageAdapter={storageAdapter} />);
    await user.click(await screen.findByTestId("folder-tree-empty-cta"));
    await waitFor(() => expect(chats.size).toBe(1));
    expect([...chats.values()][0]?.folderId).toBeNull();
  });
});

describe("<ChatPage> with an async IPC-shaped client", () => {
  it("renders chat-page and the rail instead of crashing on first paint", async () => {
    const { fake } = createIpcShapedFake();
    const adapter = createExplorerAdapter(fake);
    render(<ChatPage client={adapter} />);
    expect(screen.getByTestId("chat-page")).toBeInTheDocument();
    expect(await screen.findByTestId("folder-tree-empty")).toBeInTheDocument();
    expect(screen.getByTestId("media-composer")).toBeInTheDocument();
  });

  it("renders the breadcrumb ancestors for an active chat via the async client", async () => {
    const { fake } = createIpcShapedFake();
    const folder = await fake.createFolder(null, "Work");
    const chat = await fake.createChat({ folderId: folder.id, title: "Draft", modelId: "m" });
    const adapter = createExplorerAdapter(fake);
    const user = userEvent.setup();
    render(<ChatPage client={adapter} />);
    await user.click(await screen.findByTestId(`tree-row-folder-${folder.id}`));
    await user.click(await screen.findByTestId(`tree-row-chat-${chat.id}`));
    await waitFor(() =>
      expect(screen.getByTestId("chat-breadcrumb")).toHaveTextContent("Work"),
    );
  });

  it("no longer carries the `as unknown as ChatExplorerClient` cast (exit gate)", () => {
    const source = readFileSync(
      path.resolve(__dirname, "../src/modules/chat/ChatPage.tsx"),
      "utf8",
    );
    expect(source).not.toContain("as unknown as ChatExplorerClient");
  });
});

describe("<ModuleErrorBoundary>", () => {
  it("degrades a module crash to an in-pane error instead of a blank app", () => {
    const Bomb = (): JSX.Element => {
      throw new Error("client.listTree is not a function");
    };
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(
      <ModuleErrorBoundary>
        <Bomb />
      </ModuleErrorBoundary>,
    );
    consoleError.mockRestore();
    expect(screen.getByTestId("module-error")).toBeInTheDocument();
    expect(screen.getByTestId("module-error-message")).toHaveTextContent(
      "client.listTree is not a function",
    );
  });
});
