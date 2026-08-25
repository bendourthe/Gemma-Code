/**
 * v2.2.8 Phase 2 -- adapt coding.session.* IPC to ChatExplorerClient so
 * Agents can reuse FolderTree. Sessions without sidecar folders render as a
 * flat list. Folders are a local overlay (not a sidecar schema).
 *
 * # DEVIATION: deleting an overlay folder reparents sessions instead of
 * calling coding.session.delete on each child. Folders are chrome-only;
 * destroying agent transcripts because a local folder was removed would be
 * the wrong failure mode.
 */

import { ipcCall, type IpcReply } from "../../lib/ipc";
import type { AsyncChatExplorerClient } from "../../modules/chat/chatExplorerClient";
import type {
  Chat,
  ChatExplorerSearchHit,
  Folder,
  FolderTreeNode,
} from "../../modules/chat/types";
import type {
  CodingSessionListResponseT,
  CodingSessionStartResponseT,
  CodingSessionSummaryT,
} from "../../../sidecar/src/protocol";

export const CODING_FOLDER_OVERLAY_KEY = "nexus.coding.explorerFolders";

export interface CodingExplorerBackend {
  listSessions(): Promise<readonly CodingSessionSummaryT[]>;
  startSession(input: {
    title: string;
    modelId: string;
    workspacePath?: string;
  }): Promise<CodingSessionSummaryT>;
  renameSession(sessionId: string, title: string): Promise<CodingSessionSummaryT>;
  deleteSession(sessionId: string): Promise<void>;
}

interface FolderOverlay {
  folders: Folder[];
  sessionFolders: Record<string, string | null>;
}

function emptyOverlay(): FolderOverlay {
  return { folders: [], sessionFolders: {} };
}

function makeId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "id-" + Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
}

function unwrap<T>(reply: IpcReply<T>): T {
  if (!reply.ok) throw new Error(reply.message);
  return reply.value;
}

function asSummary(
  session: CodingSessionSummaryT | (CodingSessionStartResponseT & { title?: string; messageCount?: number }),
): CodingSessionSummaryT {
  if ("title" in session && "messageCount" in session && "sessionId" in session) {
    return {
      sessionId: session.sessionId,
      modelId: session.modelId,
      family: session.family,
      title: session.title ?? "Untitled session",
      createdAt: session.createdAt,
      messageCount: session.messageCount ?? 0,
    };
  }
  return session as CodingSessionSummaryT;
}

export function createIpcCodingExplorerBackend(): CodingExplorerBackend {
  return {
    async listSessions() {
      const value = unwrap(
        await ipcCall<CodingSessionListResponseT>("coding.sessions.list", {}),
      );
      return value.sessions;
    },
    async startSession(input) {
      const value = unwrap(
        await ipcCall<CodingSessionStartResponseT>("coding.session.start", {
          modelId: input.modelId,
          title: input.title,
          ...(input.workspacePath ? { workspacePath: input.workspacePath } : {}),
        }),
      );
      return asSummary({
        ...value,
        title: input.title,
        messageCount: 0,
      });
    },
    async renameSession(sessionId, title) {
      const value = unwrap(
        await ipcCall<{ session: CodingSessionSummaryT }>("coding.session.rename", {
          sessionId,
          title,
        }),
      );
      return value.session;
    },
    async deleteSession(sessionId) {
      unwrap(await ipcCall("coding.session.delete", { sessionId }));
    },
  };
}

function readOverlay(key: string): FolderOverlay {
  if (typeof window === "undefined") return emptyOverlay();
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return emptyOverlay();
    const parsed = JSON.parse(raw) as Partial<FolderOverlay>;
    if (!Array.isArray(parsed.folders)) return emptyOverlay();
    return {
      folders: parsed.folders,
      sessionFolders:
        parsed.sessionFolders && typeof parsed.sessionFolders === "object"
          ? parsed.sessionFolders
          : {},
    };
  } catch {
    return emptyOverlay();
  }
}

function writeOverlay(key: string, overlay: FolderOverlay): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(overlay));
  } catch {
    /* best-effort */
  }
}

function sessionToChat(session: CodingSessionSummaryT, folderId: string | null): Chat {
  const createdAt = Date.parse(session.createdAt);
  const ts = Number.isFinite(createdAt) ? createdAt : Date.now();
  return {
    id: session.sessionId,
    folderId,
    title: session.title.trim() || "Untitled session",
    modelId: session.modelId,
    contextScopeId: folderId,
    createdAt: ts,
    updatedAt: ts,
    messageCount: session.messageCount,
    persona: null,
    userRenamed: true,
  };
}

function buildTree(folders: readonly Folder[], chats: readonly Chat[]): FolderTreeNode {
  const byParent = new Map<string | null, Folder[]>();
  for (const folder of folders) {
    const bucket = byParent.get(folder.parentId) ?? [];
    bucket.push(folder);
    byParent.set(folder.parentId, bucket);
  }
  for (const bucket of byParent.values()) bucket.sort((a, b) => a.name.localeCompare(b.name));
  const chatsByFolder = new Map<string | null, Chat[]>();
  for (const chat of chats) {
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

function isAncestor(folders: readonly Folder[], ancestorId: string, nodeId: string): boolean {
  let current: string | null = nodeId;
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const seen = new Set<string>();
  while (current !== null) {
    if (current === ancestorId) return true;
    if (seen.has(current)) return false;
    seen.add(current);
    current = byId.get(current)?.parentId ?? null;
  }
  return false;
}

export interface CodingSessionsAsChatExplorerOpts {
  backend: CodingExplorerBackend;
  getWorkspacePath: () => string;
  getModelId: () => string;
  overlayKey?: string;
  persistOverlay?: boolean;
  initialOverlay?: FolderOverlay;
  onSessionCreated?: (session: CodingSessionSummaryT) => void;
}

export function createCodingSessionsAsChatExplorer(
  opts: CodingSessionsAsChatExplorerOpts,
): AsyncChatExplorerClient {
  const overlayKey = opts.overlayKey ?? CODING_FOLDER_OVERLAY_KEY;
  const persist = opts.persistOverlay !== false;
  let overlay: FolderOverlay = opts.initialOverlay
    ? {
        folders: [...opts.initialOverlay.folders],
        sessionFolders: { ...opts.initialOverlay.sessionFolders },
      }
    : persist
      ? readOverlay(overlayKey)
      : emptyOverlay();

  const save = (): void => {
    if (persist) writeOverlay(overlayKey, overlay);
  };

  const folderMap = (): Map<string, Folder> => new Map(overlay.folders.map((f) => [f.id, f]));

  const chatsFromSessions = async (): Promise<Chat[]> => {
    const sessions = await opts.backend.listSessions();
    return sessions.map((session) =>
      sessionToChat(session, overlay.sessionFolders[session.sessionId] ?? null),
    );
  };

  const requireFolder = (id: string): Folder => {
    const folder = overlay.folders.find((row) => row.id === id);
    if (!folder) throw new Error(`folder not found: ${id}`);
    return folder;
  };

  return {
    async listTree() {
      const chats = await chatsFromSessions();
      return buildTree(overlay.folders, chats);
    },
    async createFolder(input) {
      const name = input.name.trim();
      if (!name) throw new Error("folder name is required");
      if (input.parentId !== null) requireFolder(input.parentId);
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
      overlay = { ...overlay, folders: [...overlay.folders, folder] };
      save();
      return folder;
    },
    async renameFolder(id, name) {
      const trimmed = name.trim();
      if (!trimmed) throw new Error("folder name is required");
      const folder = requireFolder(id);
      const updated: Folder = { ...folder, name: trimmed, updatedAt: Date.now() };
      overlay = {
        ...overlay,
        folders: overlay.folders.map((row) => (row.id === id ? updated : row)),
      };
      save();
      return updated;
    },
    async moveFolder(id, newParentId) {
      const folder = requireFolder(id);
      if (newParentId === id) throw new Error("cannot move folder into itself");
      if (newParentId !== null) {
        requireFolder(newParentId);
        if (isAncestor(overlay.folders, id, newParentId)) {
          throw new Error("cannot move folder into its own descendant");
        }
      }
      const updated: Folder = { ...folder, parentId: newParentId, updatedAt: Date.now() };
      overlay = {
        ...overlay,
        folders: overlay.folders.map((row) => (row.id === id ? updated : row)),
      };
      save();
      return updated;
    },
    async deleteFolder(id) {
      const folder = overlay.folders.find((row) => row.id === id);
      if (!folder) return;
      const nextFolders = overlay.folders
        .filter((row) => row.id !== id)
        .map((row) => (row.parentId === id ? { ...row, parentId: folder.parentId } : row));
      const nextSessionFolders = { ...overlay.sessionFolders };
      for (const [sessionId, folderId] of Object.entries(nextSessionFolders)) {
        if (folderId === id) nextSessionFolders[sessionId] = folder.parentId;
      }
      overlay = { folders: nextFolders, sessionFolders: nextSessionFolders };
      save();
    },
    async createChat(input) {
      const workspacePath = opts.getWorkspacePath().trim();
      if (!workspacePath) {
        throw new Error("Choose a workspace folder before starting a coding session.");
      }
      const title = input.title.trim() || "New session";
      const started = await opts.backend.startSession({
        title,
        modelId: input.modelId || opts.getModelId(),
        workspacePath,
      });
      if (input.folderId !== null) {
        requireFolder(input.folderId);
        overlay = {
          ...overlay,
          sessionFolders: { ...overlay.sessionFolders, [started.sessionId]: input.folderId },
        };
        save();
      }
      opts.onSessionCreated?.(started);
      return sessionToChat(started, input.folderId);
    },
    async renameChat(id, title) {
      const trimmed = title.trim();
      if (!trimmed) throw new Error("session title is required");
      const renamed = await opts.backend.renameSession(id, trimmed);
      return sessionToChat(renamed, overlay.sessionFolders[id] ?? null);
    },
    async moveChat(id, newFolderId) {
      if (newFolderId !== null) requireFolder(newFolderId);
      overlay = {
        ...overlay,
        sessionFolders: { ...overlay.sessionFolders, [id]: newFolderId },
      };
      save();
      const chats = await chatsFromSessions();
      const chat = chats.find((row) => row.id === id);
      if (!chat) throw new Error(`session not found: ${id}`);
      return chat;
    },
    async deleteChat(id) {
      await opts.backend.deleteSession(id);
      const nextSessionFolders = { ...overlay.sessionFolders };
      delete nextSessionFolders[id];
      overlay = { ...overlay, sessionFolders: nextSessionFolders };
      save();
    },
    async getFolder(id) {
      return folderMap().get(id) ?? null;
    },
    async getChat(id) {
      const chats = await chatsFromSessions();
      return chats.find((row) => row.id === id) ?? null;
    },
    async ancestors(folderId) {
      if (folderId === null) return [];
      const byId = folderMap();
      const chain: Folder[] = [];
      let current: string | null = folderId;
      const seen = new Set<string>();
      while (current !== null && !seen.has(current)) {
        seen.add(current);
        const folder = byId.get(current);
        if (!folder) break;
        chain.unshift(folder);
        current = folder.parentId;
      }
      return chain;
    },
    async search(query, limit = 25) {
      const trimmed = query.trim().toLowerCase();
      if (!trimmed) return [];
      const tree = buildTree(overlay.folders, await chatsFromSessions());
      const hits: ChatExplorerSearchHit[] = [];
      const walk = (node: FolderTreeNode): void => {
        if (node.folder && node.folder.name.toLowerCase().includes(trimmed)) {
          hits.push({
            kind: "folder",
            id: node.folder.id,
            name: node.folder.name,
            parentId: node.folder.parentId,
          });
        }
        for (const chat of node.chats) {
          if (chat.title.toLowerCase().includes(trimmed)) {
            hits.push({
              kind: "chat",
              id: chat.id,
              name: chat.title,
              parentId: chat.folderId,
            });
          }
        }
        for (const child of node.children) walk(child);
      };
      walk(tree);
      return hits.slice(0, limit);
    },
  };
}
