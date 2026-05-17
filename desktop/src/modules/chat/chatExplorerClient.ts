/**
 * v1.0.0 Phase 4 -- frontend chat-explorer client.
 *
 * Mirrors the surface area of the root `ChatExplorerStore` but runs purely
 * in-memory inside the Vite bundle. The eventual sidecar-backed client (to
 * be added when the IPC widening from known-gap `3.P1.N` lands) will
 * implement the same interface; this lets the UI tests run without a real
 * SQLite database while keeping the call sites stable.
 */

import type {
  Chat,
  ChatExplorerSearchHit,
  CreateChatInput,
  CreateFolderInput,
  Folder,
  FolderTreeNode,
} from "./types";

export interface ChatExplorerClient {
  listTree(): FolderTreeNode;
  createFolder(input: CreateFolderInput): Folder;
  renameFolder(id: string, name: string): Folder;
  moveFolder(id: string, newParentId: string | null): Folder;
  deleteFolder(id: string): void;
  createChat(input: CreateChatInput): Chat;
  renameChat(id: string, title: string): Chat;
  moveChat(id: string, newFolderId: string | null): Chat;
  deleteChat(id: string): void;
  getFolder(id: string): Folder | null;
  getChat(id: string): Chat | null;
  ancestors(folderId: string | null): readonly Folder[];
  search(query: string, limit?: number): readonly ChatExplorerSearchHit[];
}

function makeId(): string {
  // 16 random bytes hex-encoded is sufficient for in-memory uniqueness.
  // crypto.randomUUID is unavailable in some test environments, so we use a
  // Math.random fallback here -- the frontend never persists these ids.
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "id-" + Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
}

export class InMemoryChatExplorerClient implements ChatExplorerClient {
  private readonly folders = new Map<string, Folder>();
  private readonly chats = new Map<string, Chat>();

  listTree(): FolderTreeNode {
    const byParent = new Map<string | null, Folder[]>();
    for (const folder of this.folders.values()) {
      const bucket = byParent.get(folder.parentId) ?? [];
      bucket.push(folder);
      byParent.set(folder.parentId, bucket);
    }
    for (const bucket of byParent.values()) bucket.sort((a, b) => a.name.localeCompare(b.name));
    const chatsByFolder = new Map<string | null, Chat[]>();
    for (const chat of this.chats.values()) {
      const bucket = chatsByFolder.get(chat.folderId) ?? [];
      bucket.push(chat);
      chatsByFolder.set(chat.folderId, bucket);
    }
    for (const bucket of chatsByFolder.values()) bucket.sort((a, b) => a.title.localeCompare(b.title));

    const buildNode = (folder: Folder | null): FolderTreeNode => {
      const parentKey = folder?.id ?? null;
      return {
        folder,
        children: (byParent.get(parentKey) ?? []).map((child) => buildNode(child)),
        chats: chatsByFolder.get(parentKey) ?? [],
      };
    };
    return buildNode(null);
  }

  createFolder(input: CreateFolderInput): Folder {
    const name = input.name.trim();
    if (!name) throw new Error("folder name is required");
    if (input.parentId !== null && !this.folders.has(input.parentId)) {
      throw new Error(`parent folder not found: ${input.parentId}`);
    }
    const now = Date.now();
    const folder: Folder = {
      id: makeId(),
      parentId: input.parentId,
      name,
      color: input.color ?? null,
      icon: input.icon ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.folders.set(folder.id, folder);
    return folder;
  }

  renameFolder(id: string, name: string): Folder {
    const trimmed = name.trim();
    if (!trimmed) throw new Error("folder name is required");
    const folder = this.folders.get(id);
    if (!folder) throw new Error(`folder not found: ${id}`);
    const updated: Folder = { ...folder, name: trimmed, updatedAt: Date.now() };
    this.folders.set(id, updated);
    return updated;
  }

  moveFolder(id: string, newParentId: string | null): Folder {
    const folder = this.folders.get(id);
    if (!folder) throw new Error(`folder not found: ${id}`);
    if (newParentId === id) throw new Error("cannot move folder into itself");
    if (newParentId !== null) {
      const parent = this.folders.get(newParentId);
      if (!parent) throw new Error(`new parent folder not found: ${newParentId}`);
      if (this.isAncestor(id, newParentId)) {
        throw new Error("cannot move folder into its own descendant");
      }
    }
    const updated: Folder = { ...folder, parentId: newParentId, updatedAt: Date.now() };
    this.folders.set(id, updated);
    return updated;
  }

  deleteFolder(id: string): void {
    const folder = this.folders.get(id);
    if (!folder) return;
    // Recursively delete descendants and their chats.
    const stack: string[] = [id];
    const toDelete = new Set<string>();
    while (stack.length > 0) {
      const current = stack.pop()!;
      toDelete.add(current);
      for (const candidate of this.folders.values()) {
        if (candidate.parentId === current) stack.push(candidate.id);
      }
    }
    for (const chat of Array.from(this.chats.values())) {
      if (chat.folderId !== null && toDelete.has(chat.folderId)) {
        this.chats.delete(chat.id);
      }
    }
    for (const fid of toDelete) this.folders.delete(fid);
  }

  createChat(input: CreateChatInput): Chat {
    const title = input.title.trim();
    if (!title) throw new Error("chat title is required");
    if (!input.modelId.trim()) throw new Error("chat modelId is required");
    if (input.folderId !== null && !this.folders.has(input.folderId)) {
      throw new Error(`folder not found: ${input.folderId}`);
    }
    const now = Date.now();
    const chat: Chat = {
      id: makeId(),
      folderId: input.folderId,
      title,
      modelId: input.modelId,
      contextScopeId:
        input.contextScopeId === undefined ? input.folderId : input.contextScopeId,
      createdAt: now,
      updatedAt: now,
      messageCount: 0,
    };
    this.chats.set(chat.id, chat);
    return chat;
  }

  renameChat(id: string, title: string): Chat {
    const trimmed = title.trim();
    if (!trimmed) throw new Error("chat title is required");
    const chat = this.chats.get(id);
    if (!chat) throw new Error(`chat not found: ${id}`);
    const updated: Chat = { ...chat, title: trimmed, updatedAt: Date.now() };
    this.chats.set(id, updated);
    return updated;
  }

  moveChat(id: string, newFolderId: string | null): Chat {
    const chat = this.chats.get(id);
    if (!chat) throw new Error(`chat not found: ${id}`);
    if (newFolderId !== null && !this.folders.has(newFolderId)) {
      throw new Error(`folder not found: ${newFolderId}`);
    }
    const updated: Chat = {
      ...chat,
      folderId: newFolderId,
      contextScopeId: newFolderId,
      updatedAt: Date.now(),
    };
    this.chats.set(id, updated);
    return updated;
  }

  deleteChat(id: string): void {
    this.chats.delete(id);
  }

  getFolder(id: string): Folder | null {
    return this.folders.get(id) ?? null;
  }

  getChat(id: string): Chat | null {
    return this.chats.get(id) ?? null;
  }

  ancestors(folderId: string | null): readonly Folder[] {
    const chain: Folder[] = [];
    let cursor: string | null = folderId;
    const seen = new Set<string>();
    while (cursor !== null) {
      if (seen.has(cursor)) break;
      seen.add(cursor);
      const folder = this.folders.get(cursor);
      if (!folder) break;
      chain.push(folder);
      cursor = folder.parentId;
    }
    return chain.reverse();
  }

  search(query: string, limit = 25): readonly ChatExplorerSearchHit[] {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return [];
    const folderHits: ChatExplorerSearchHit[] = [];
    for (const folder of this.folders.values()) {
      if (folder.name.toLowerCase().includes(trimmed)) {
        folderHits.push({
          kind: "folder",
          id: folder.id,
          name: folder.name,
          parentId: folder.parentId,
        });
      }
    }
    const chatHits: ChatExplorerSearchHit[] = [];
    for (const chat of this.chats.values()) {
      if (chat.title.toLowerCase().includes(trimmed)) {
        chatHits.push({
          kind: "chat",
          id: chat.id,
          name: chat.title,
          parentId: chat.folderId,
        });
      }
    }
    folderHits.sort((a, b) => a.name.localeCompare(b.name));
    chatHits.sort((a, b) => a.name.localeCompare(b.name));
    return [...folderHits, ...chatHits].slice(0, limit);
  }

  private isAncestor(ancestorId: string, candidateId: string): boolean {
    let cursor: string | null = candidateId;
    const seen = new Set<string>();
    while (cursor !== null) {
      if (seen.has(cursor)) return false;
      seen.add(cursor);
      const folder = this.folders.get(cursor);
      if (!folder) return false;
      if (folder.parentId === ancestorId) return true;
      cursor = folder.parentId;
    }
    return false;
  }
}
