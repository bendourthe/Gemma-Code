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
 */

import { ipcCall } from "../../lib/ipc";
import type {
  Chat,
  ChatMessageRecord,
  Folder,
  FolderTreeNode,
} from "../../../../modules/chat/storage/ChatExplorerStore.types";

export interface ChatExplorerClient {
  tree(): Promise<FolderTreeNode>;
  createFolder(parentId: string | null, name: string): Promise<Folder>;
  renameFolder(id: string, name: string): Promise<Folder>;
  moveFolder(id: string, parentId: string | null): Promise<Folder>;
  deleteFolder(id: string): Promise<void>;
  createChat(folderId: string | null, title: string, modelId: string): Promise<Chat>;
  /** `byUser` pins the title so auto-titling can never overwrite it. */
  renameChat(id: string, title: string, byUser?: boolean): Promise<Chat>;
  moveChat(id: string, folderId: string | null): Promise<Chat>;
  deleteChat(id: string): Promise<void>;
  setPersona(id: string, persona: string | null): Promise<void>;
  appendMessage(input: {
    chatId: string;
    role: "user" | "assistant";
    content: string;
    attachments?: readonly string[];
  }): Promise<ChatMessageRecord>;
  listMessages(chatId: string, limit?: number): Promise<readonly ChatMessageRecord[]>;
  generateTitle(chatId: string, firstMessage: string): Promise<{ title: string; source: string }>;
}

async function call<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  const reply = await ipcCall<T>(method as never, params);
  if (!reply.ok) throw new Error(reply.message);
  return reply.value;
}

export function createIpcChatExplorerClient(): ChatExplorerClient {
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
    createChat: (folderId, title, modelId) =>
      call<Chat>("chat.explorer.createChat", { folderId, title, modelId }),
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
    async setPersona(id, persona) {
      await call("chat.explorer.setPersona", { id, persona });
    },
    appendMessage: (input) =>
      call<ChatMessageRecord>("chat.explorer.appendMessage", {
        chatId: input.chatId,
        role: input.role,
        content: input.content,
        ...(input.attachments && input.attachments.length > 0
          ? { attachments: [...input.attachments] }
          : {}),
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
