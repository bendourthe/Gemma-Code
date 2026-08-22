/**
 * Shared types for the Local Chatbot Explorer storage layer (v1.0.0 Phase 4).
 *
 * Lives outside the SQLite-backed `ChatExplorerStore` so that the desktop
 * frontend can import the type surface without dragging the `better-sqlite3`
 * native module into the Vite bundle. The frontend talks to the store via
 * IPC (sidecar) but renders rows shaped by the types declared here.
 */

/** Identifier used for the synthetic root folder (parentId === null). */
export const ROOT_FOLDER_ID = null;

export interface Folder {
  id: string;
  /** `null` for top-level (root-rooted) folders. */
  parentId: string | null;
  name: string;
  /** ISO timestamp (ms since epoch). */
  createdAt: number;
  updatedAt: number;
  color?: string | null;
  icon?: string | null;
}

export interface Chat {
  id: string;
  /** Folders are required: a chat with `folderId === null` lives at the root. */
  folderId: string | null;
  title: string;
  modelId: string;
  /**
   * Memory scope that retrieval is constrained to (see MemoryHub.retrieve).
   * Defaults to the parent `folderId`; the root scope is `null`.
   */
  contextScopeId: string | null;
  createdAt: number;
  updatedAt: number;
  /** Mirrored from ChatHistoryStore; updated by `bumpMessageCount`. */
  messageCount: number;
  /**
   * v2.2.0 Phase 5: per-chat system prompt. Previously unpersisted React
   * state, so it silently vanished on reload.
   */
  persona?: string | null;
  /**
   * v2.2.0 Phase 5: true once the USER renamed this chat by hand. Auto-titling
   * must never overwrite a title the user chose.
   */
  userRenamed?: boolean;
}

/** v2.2.0 Phase 5: one persisted message turn. */
export interface ChatMessageRecord {
  id: string;
  chatId: string;
  role: "user" | "assistant";
  content: string;
  attachments: readonly string[];
  createdAt: number;
}

export interface AppendMessageInput {
  chatId: string;
  role: "user" | "assistant";
  content: string;
  attachments?: readonly string[];
  /** Injected in tests for deterministic ordering. */
  id?: string;
  createdAt?: number;
}

/** Tree node returned by `listTree()`; children are folders, with chats as a sibling list. */
export interface FolderTreeNode {
  folder: Folder | null;
  /** Folders nested directly under this node. */
  children: FolderTreeNode[];
  /** Chats that live directly inside this folder. */
  chats: Chat[];
}

export interface ChatExplorerSearchHit {
  kind: "folder" | "chat";
  id: string;
  name: string;
  /** For chats: their `folderId`; for folders: their `parentId`. */
  parentId: string | null;
}

export interface CreateFolderInput {
  parentId: string | null;
  name: string;
  color?: string | null;
  icon?: string | null;
}

export interface CreateChatInput {
  folderId: string | null;
  title: string;
  modelId: string;
  /**
   * Optional scope override. When omitted, the store derives the scope from
   * the parent folder (root chats get `null`).
   */
  contextScopeId?: string | null;
}
