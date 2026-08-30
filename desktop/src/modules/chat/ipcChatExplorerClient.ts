/**
 * v2.2.0 Phase 5 (5.1) -- production chat explorer client (closes 3.P1.N).
 *
 * Replaces `InMemoryChatExplorerClient` as the app default. That stub held
 * folders and chats in two `Map`s, so every conversation, folder, and persona
 * disappeared on reload while a finished SQLite store sat unwired in
 * `modules/chat/storage/`.
 *
 * The in-memory client is kept for tests and for running outside Tauri, where
 * there is no sidecar to talk to.
 *
 * v2.2.3 Phase 1 (1.1): the raw IPC surface below is now wrapped by
 * `createExplorerAdapter`, which satisfies the `AsyncChatExplorerClient`
 * contract FolderTree/ChatPage consume (listTree, object-form createFolder,
 * getChat/getFolder/ancestors/search against a cached tree). Before this,
 * ChatPage cast the raw client `as unknown as` the sync interface and the
 * first `listTree()` call blanked the whole app (P0, U7).
 */

import { ipcCall } from "../../lib/ipc";
import type {
  AsyncChatExplorerClient,
} from "./chatExplorerClient";
import type {
  Chat,
  ChatExplorerSearchHit,
  ChatMessageRecord,
  Folder,
  FolderTreeNode,
} from "./types";

/** The raw sidecar IPC surface: async, positional args, sidecar-only extras. */
export interface IpcChatExplorerClient {
  tree(): Promise<FolderTreeNode>;
  createFolder(parentId: string | null, name: string): Promise<Folder>;
  renameFolder(id: string, name: string): Promise<Folder>;
  moveFolder(id: string, parentId: string | null): Promise<Folder>;
  deleteFolder(id: string): Promise<void>;
  createChat(
    folderId: string | null | { folderId: string | null; title: string; modelId: string },
    title?: string,
    modelId?: string,
  ): Promise<Chat>;
  /** `byUser` pins the title so auto-titling can never overwrite it. */
  renameChat(id: string, title: string, byUser?: boolean): Promise<Chat>;
  moveChat(id: string, folderId: string | null): Promise<Chat>;
  deleteChat(id: string): Promise<void>;
  archiveChat?(id: string): Promise<void>;
  setPersona(id: string, persona: string | null): Promise<void>;
  /** OPTIONAL so IPC-shaped fakes in tests can omit it; the adapter falls back to its cached tree. */
  search?(query: string, limit?: number): Promise<readonly ChatExplorerSearchHit[]>;
  appendMessage(input: {
    chatId: string;
    role: "user" | "assistant";
    content: string;
    attachments?: readonly string[];
    inputTokens?: number | null;
    reasoningTokens?: number | null;
    reasoningText?: string | null;
    outputTokens?: number | null;
    tokensEstimated?: boolean;
    requestUsage?: ChatMessageRecord["requestUsage"];
    messageUsage?: ChatMessageRecord["messageUsage"];
  }): Promise<ChatMessageRecord>;
  listMessages(chatId: string, limit?: number): Promise<readonly ChatMessageRecord[]>;
  generateTitle(chatId: string, firstMessage: string): Promise<{ title: string; source: string }>;
}

async function call<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  const reply = await ipcCall<T>(method as never, params);
  if (!reply.ok) throw new Error(reply.message);
  return reply.value;
}

/** Narrow one `chat.explorer.search` hit (the wire schema is `unknown[]`). */
function isSearchHit(value: unknown): value is ChatExplorerSearchHit {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    (v.kind === "folder" || v.kind === "chat") &&
    typeof v.id === "string" &&
    typeof v.name === "string" &&
    (v.parentId === null || typeof v.parentId === "string")
  );
}

export function createIpcChatExplorerClient(): IpcChatExplorerClient {
  return {
    async tree() {
      const { tree } = await call<{ tree: FolderTreeNode }>("chat.explorer.tree");
      return tree;
    },
    createFolder: (parentId, name) =>
      call<Folder>("chat.explorer.createFolder", { parentId, name }),
    renameFolder: (id, name) => call<Folder>("chat.explorer.renameFolder", { id, name }),
    moveFolder: (id, parentId) => call<Folder>("chat.explorer.moveFolder", { id, parentId }),
    async deleteFolder(id) {
      await call("chat.explorer.deleteFolder", { id });
    },
    createChat(folderIdOrInput: string | null | { folderId: string | null; title: string; modelId: string }, title?: string, modelId?: string) {
      if (folderIdOrInput !== null && typeof folderIdOrInput === "object") {
        return call<Chat>("chat.explorer.createChat", folderIdOrInput);
      }
      return call<Chat>("chat.explorer.createChat", {
        folderId: folderIdOrInput,
        title,
        modelId,
      });
    },
    renameChat: (id, title, byUser) =>
      call<Chat>("chat.explorer.renameChat", {
        id,
        title,
        ...(byUser === undefined ? {} : { byUser }),
      }),
    moveChat: (id, folderId) => call<Chat>("chat.explorer.moveChat", { id, folderId }),
    async deleteChat(id) {
      await call("chat.explorer.deleteChat", { id });
    },
    async archiveChat(id) {
      await call("sessions.archive", { pillar: "chatbot", id });
    },
    async setPersona(id, persona) {
      await call("chat.explorer.setPersona", { id, persona });
    },
    async search(query, limit) {
      const { hits } = await call<{ hits: unknown[] }>("chat.explorer.search", {
        query,
        ...(limit ? { limit } : {}),
      });
      return hits.filter(isSearchHit);
    },
    appendMessage: (input) =>
      call<ChatMessageRecord>("chat.explorer.appendMessage", {
        chatId: input.chatId,
        role: input.role,
        content: input.content,
        ...(input.attachments && input.attachments.length > 0
          ? { attachments: [...input.attachments] }
          : {}),
        ...(input.inputTokens !== undefined ? { inputTokens: input.inputTokens } : {}),
        ...(input.reasoningTokens !== undefined ? { reasoningTokens: input.reasoningTokens } : {}),
        ...(input.reasoningText !== undefined ? { reasoningText: input.reasoningText } : {}),
        ...(input.outputTokens !== undefined ? { outputTokens: input.outputTokens } : {}),
        ...(input.tokensEstimated ? { tokensEstimated: true } : {}),
        ...(input.requestUsage ? { requestUsage: input.requestUsage } : {}),
        ...(input.messageUsage ? { messageUsage: input.messageUsage } : {}),
      }),
    async listMessages(chatId, limit) {
      const { messages } = await call<{ messages: ChatMessageRecord[] }>(
        "chat.explorer.listMessages",
        { chatId, ...(limit ? { limit } : {}) },
      );
      return messages;
    },
    generateTitle: (chatId, firstMessage) =>
      call<{ title: string; source: string }>("chat.generateTitle", { chatId, firstMessage }),
  };
}

function findFolderIn(node: FolderTreeNode, id: string): Folder | null {
  if (node.folder?.id === id) return node.folder;
  for (const child of node.children) {
    const hit = findFolderIn(child, id);
    if (hit) return hit;
  }
  return null;
}

function findChatIn(node: FolderTreeNode, id: string): Chat | null {
  for (const chat of node.chats) {
    if (chat.id === id) return chat;
  }
  for (const child of node.children) {
    const hit = findChatIn(child, id);
    if (hit) return hit;
  }
  return null;
}

function ancestorsIn(
  node: FolderTreeNode,
  folderId: string,
  trail: readonly Folder[],
): readonly Folder[] | null {
  const next = node.folder ? [...trail, node.folder] : trail;
  if (node.folder?.id === folderId) return next;
  for (const child of node.children) {
    const hit = ancestorsIn(child, folderId, next);
    if (hit) return hit;
  }
  return null;
}

function searchTree(
  tree: FolderTreeNode,
  query: string,
  limit: number,
): readonly ChatExplorerSearchHit[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return [];
  const folderHits: ChatExplorerSearchHit[] = [];
  const chatHits: ChatExplorerSearchHit[] = [];
  const visit = (node: FolderTreeNode): void => {
    if (node.folder && node.folder.name.toLowerCase().includes(trimmed)) {
      folderHits.push({
        kind: "folder",
        id: node.folder.id,
        name: node.folder.name,
        parentId: node.folder.parentId,
      });
    }
    for (const chat of node.chats) {
      if (chat.title.toLowerCase().includes(trimmed)) {
        chatHits.push({ kind: "chat", id: chat.id, name: chat.title, parentId: chat.folderId });
      }
    }
    for (const child of node.children) visit(child);
  };
  visit(tree);
  folderHits.sort((a, b) => a.name.localeCompare(b.name));
  chatHits.sort((a, b) => a.name.localeCompare(b.name));
  return [...folderHits, ...chatHits].slice(0, limit);
}

/**
 * Wrap the raw IPC surface into the `AsyncChatExplorerClient` contract the UI
 * consumes. Reads (`getFolder`, `getChat`, `ancestors`, and the search
 * fallback) resolve against a cached tree; every mutation invalidates that
 * cache so the next read refetches -- the single source of truth stays the
 * sidecar store, and no remapped ids are ever dual-written.
 */
export type ExplorerAdapter = AsyncChatExplorerClient &
  Pick<IpcChatExplorerClient, "appendMessage" | "listMessages">;

export function createExplorerAdapter(ipc: IpcChatExplorerClient): ExplorerAdapter {
  let cachedTree: FolderTreeNode | null = null;

  const refreshTree = async (): Promise<FolderTreeNode> => {
    const tree = await ipc.tree();
    cachedTree = tree;
    return tree;
  };
  const ensureTree = async (): Promise<FolderTreeNode> => cachedTree ?? refreshTree();
  const invalidate = <T>(value: T): T => {
    cachedTree = null;
    return value;
  };

  return {
    listTree: () => refreshTree(),
    createFolder: async (input) => invalidate(await ipc.createFolder(input.parentId, input.name)),
    renameFolder: async (id, name) => invalidate(await ipc.renameFolder(id, name)),
    moveFolder: async (id, newParentId) => invalidate(await ipc.moveFolder(id, newParentId)),
    deleteFolder: async (id) => {
      await ipc.deleteFolder(id);
      cachedTree = null;
    },
    createChat: async (input) => invalidate(await ipc.createChat(input)),
    renameChat: async (id, title, byUser) => invalidate(await ipc.renameChat(id, title, byUser)),
    moveChat: async (id, newFolderId) => invalidate(await ipc.moveChat(id, newFolderId)),
    deleteChat: async (id) => {
      await ipc.deleteChat(id);
      cachedTree = null;
    },
    archiveChat: async (id) => {
      if (!ipc.archiveChat) throw new Error("Archive is unavailable.");
      await ipc.archiveChat(id);
      cachedTree = null;
    },
    getFolder: async (id) => findFolderIn(await ensureTree(), id),
    getChat: async (id) => findChatIn(await ensureTree(), id),
    ancestors: async (folderId) => {
      if (folderId === null) return [];
      return ancestorsIn(await ensureTree(), folderId, []) ?? [];
    },
    search: async (query, limit = 25) => {
      // The sidecar implements `chat.explorer.search`; delegate when the raw
      // client exposes it, otherwise (IPC-shaped fakes) match the cached tree.
      if (ipc.search) return ipc.search(query, limit);
      return searchTree(await ensureTree(), query, limit);
    },
    setPersona: (id, persona) => ipc.setPersona(id, persona),
    // Kept on the adapter so Phase 4 (transcript persistence) can reach them
    // without another cast; nothing in Phase 1 calls them yet.
    appendMessage: (input) => ipc.appendMessage(input),
    listMessages: (chatId, limit) => ipc.listMessages(chatId, limit),
    generateTitle: (chatId, firstMessage) => ipc.generateTitle(chatId, firstMessage),
  };
}

/** The production explorer client: raw IPC wrapped in the async-safe adapter. */
export function createIpcChatExplorerAdapter(): ExplorerAdapter {
  return createExplorerAdapter(createIpcChatExplorerClient());
}

/**
 * True when a Tauri runtime is present. Outside it (the Vite dev server, a
 * Vitest run) there is no sidecar to talk to, so the in-memory client remains
 * the only workable choice.
 */
export function tauriAvailable(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as { __TAURI_INTERNALS__?: unknown; __TAURI__?: unknown };
  return Boolean(w.__TAURI_INTERNALS__ || w.__TAURI__);
}
