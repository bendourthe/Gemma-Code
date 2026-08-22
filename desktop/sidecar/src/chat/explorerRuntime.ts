// v2.2.0 Phase 5 (5.1) -- chat explorer persistence for the desktop app.
//
// Closes 3.P1.N. The desktop chat ran on `InMemoryChatExplorerClient`, so
// folders, chats, and every message vanished on reload -- while a finished
// SQLite store (`modules/chat/storage/ChatExplorerStore`) sat unwired beside
// it. This module owns the store instance for the sidecar and exposes the
// operations behind `chat.explorer.*`.
//
// Failure posture: a database that cannot be opened is reported as a typed
// storage error the UI can render, NOT silently swallowed into an empty tree.
// An empty tree and a broken database look identical to a user otherwise, and
// only one of them means "your chats are gone".

import * as path from "node:path";

import { ChatExplorerStore } from "../../../../modules/chat/storage/ChatExplorerStore.js";
import type {
  AppendMessageInput,
  Chat,
  ChatMessageRecord,
  Folder,
  FolderTreeNode,
} from "../../../../modules/chat/storage/ChatExplorerStore.types.js";
import { nexusHome } from "../../../../core/storage/paths.js";

const CHAT_DB_DIRNAME = "chat";
const CHAT_DB_FILENAME = "explorer.db";

export function resolveChatDbPath(homeDirFn?: () => string): string {
  return path.join(nexusHome(homeDirFn), CHAT_DB_DIRNAME, CHAT_DB_FILENAME);
}

export class ChatStorageUnavailableError extends Error {
  readonly dbPath: string;
  constructor(dbPath: string, cause: string) {
    super(`chat-storage-unavailable: ${cause}`);
    this.name = "ChatStorageUnavailableError";
    this.dbPath = dbPath;
  }
}

export interface ChatExplorerRuntime {
  readonly store: ChatExplorerStore;
  readonly dbPath: string;
}

let _runtime: ChatExplorerRuntime | null = null;
let _failure: ChatStorageUnavailableError | null = null;

/**
 * Resolve the process-wide runtime, built on first use.
 *
 * A failed open is cached too: retrying a corrupt database on every keystroke
 * would turn one problem into a stream of them.
 */
export function chatExplorerRuntime(dbPath = resolveChatDbPath()): ChatExplorerRuntime {
  if (_failure) throw _failure;
  if (_runtime) return _runtime;
  try {
    const fs = require("node:fs") as typeof import("node:fs");
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    _runtime = { store: new ChatExplorerStore(dbPath), dbPath };
    return _runtime;
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    _failure = new ChatStorageUnavailableError(dbPath, cause);
    throw _failure;
  }
}

/** Test seam: drop the memoized runtime (and any cached failure). */
export function resetChatExplorerRuntime(): void {
  try {
    _runtime?.store.close();
  } catch {
    // Closing a broken handle is best-effort.
  }
  _runtime = null;
  _failure = null;
}

export interface ExplorerTreeDto {
  tree: FolderTreeNode;
}

/** The operations behind the `chat.explorer.*` IPC surface. */
export interface ChatExplorerOps {
  tree(): ExplorerTreeDto;
  createFolder(input: { parentId: string | null; name: string }): Folder;
  renameFolder(input: { id: string; name: string }): Folder;
  moveFolder(input: { id: string; parentId: string | null }): Folder;
  deleteFolder(input: { id: string }): { ok: true };
  createChat(input: { folderId: string | null; title: string; modelId: string }): Chat;
  renameChat(input: { id: string; title: string; byUser?: boolean }): Chat;
  moveChat(input: { id: string; folderId: string | null }): Chat;
  deleteChat(input: { id: string }): { ok: true };
  setPersona(input: { id: string; persona: string | null }): { ok: true };
  appendMessage(input: AppendMessageInput): ChatMessageRecord;
  listMessages(input: { chatId: string; limit?: number }): { messages: readonly ChatMessageRecord[] };
  search(input: { query: string; limit?: number }): { hits: ReturnType<ChatExplorerStore["search"]> };
}

export function createChatExplorerOps(
  runtime: ChatExplorerRuntime = chatExplorerRuntime(),
): ChatExplorerOps {
  const { store } = runtime;
  return {
    tree: () => ({ tree: store.listTree() }),
    createFolder: (input) => store.createFolder({ parentId: input.parentId, name: input.name }),
    renameFolder: (input) => store.renameFolder(input.id, input.name),
    moveFolder: (input) => store.moveFolder(input.id, input.parentId),
    deleteFolder: (input) => {
      store.deleteFolder(input.id);
      return { ok: true };
    },
    createChat: (input) =>
      store.createChat({
        folderId: input.folderId,
        title: input.title,
        modelId: input.modelId,
      }),
    // `byUser` is what pins a title against auto-titling; a generated title
    // must never set it.
    renameChat: (input) =>
      input.byUser === true
        ? store.renameChatByUser(input.id, input.title)
        : store.renameChat(input.id, input.title),
    moveChat: (input) => store.moveChat(input.id, input.folderId),
    deleteChat: (input) => {
      store.deleteChat(input.id);
      return { ok: true };
    },
    setPersona: (input) => {
      store.setPersona(input.id, input.persona);
      return { ok: true };
    },
    appendMessage: (input) => store.appendMessage(input),
    listMessages: (input) => ({
      messages: store.listMessages(input.chatId, input.limit ?? 500),
    }),
    search: (input) => ({ hits: store.search(input.query, input.limit ?? 25) }),
  };
}
