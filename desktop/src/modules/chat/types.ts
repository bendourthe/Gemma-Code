/**
 * v1.0.0 Phase 4 -- frontend type surface for the Local Chatbot Explorer.
 *
 * Mirrors `modules/chat/storage/ChatExplorerStore.types.ts` so the desktop
 * UI does not have to import from the SQLite-backed package (which would
 * drag `better-sqlite3` into the Vite bundle). Once the desktop workspace
 * gains a published `@nexus/core` adapter the duplicate can be deleted in
 * favour of `import type { Folder, Chat } from "@nexus/chat";`.
 */

export interface Folder {
  id: string;
  parentId: string | null;
  name: string;
  createdAt: number;
  updatedAt: number;
  color?: string | null;
  icon?: string | null;
}

export interface Chat {
  id: string;
  folderId: string | null;
  title: string;
  modelId: string;
  contextScopeId: string | null;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

export interface FolderTreeNode {
  folder: Folder | null;
  children: FolderTreeNode[];
  chats: Chat[];
}

export interface ChatExplorerSearchHit {
  kind: "folder" | "chat";
  id: string;
  name: string;
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
  contextScopeId?: string | null;
}
