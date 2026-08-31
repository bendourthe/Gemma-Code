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
import type { CodingWorkspaceSelection } from "../../lib/persistence";

export const CODING_FOLDER_OVERLAY_KEY = "nexus.coding.explorerFolders";

export interface CodingExplorerBackend {
  listSessions(): Promise<readonly CodingSessionSummaryT[]>;
  startSession(input: {
    title: string;
    modelId: string;
    workspacePath: string;
    workspaceRoots: readonly string[];
    primaryRoot: string;
  }): Promise<CodingSessionSummaryT>;
  renameSession(
    sessionId: string,
    title: string,
  ): Promise<CodingSessionSummaryT>;
  deleteSession(sessionId: string): Promise<void>;
  archiveSession?(sessionId: string): Promise<void>;
}

interface FolderOverlay {
  folders: Folder[];
  sessionFolders: Record<string, string | null>;
  userRenamed: Record<string, boolean>;
}

function emptyOverlay(): FolderOverlay {
  return { folders: [], sessionFolders: {}, userRenamed: {} };
}

function makeId(): string {
  const secureRandom = globalThis.crypto;
  if (!secureRandom) {
    throw new Error(
      "A secure random generator is required to create folder IDs.",
    );
  }
  if (typeof secureRandom.randomUUID === "function") {
    return secureRandom.randomUUID();
  }
  const bytes = secureRandom.getRandomValues(new Uint8Array(16));
  return `id-${Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function unwrap<T>(reply: IpcReply<T>): T {
  if (!reply.ok) throw new Error(reply.message);
  return reply.value;
}

function asSummary(
  session:
    | CodingSessionSummaryT
    | (CodingSessionStartResponseT & { title?: string; messageCount?: number }),
): CodingSessionSummaryT {
  if (
    "title" in session &&
    "messageCount" in session &&
    "sessionId" in session
  ) {
    return {
      sessionId: session.sessionId,
      modelId: session.modelId,
      family: session.family,
      title: session.title ?? "Untitled session",
      createdAt: session.createdAt,
      messageCount: session.messageCount ?? 0,
      workspaceId: session.workspaceId,
      workspaceRoots: session.workspaceRoots,
      primaryRoot: session.primaryRoot,
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
          workspacePath: input.workspacePath,
          workspaceRoots: input.workspaceRoots,
          primaryRoot: input.primaryRoot,
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
        await ipcCall<{ session: CodingSessionSummaryT }>(
          "coding.session.rename",
          {
            sessionId,
            title,
          },
        ),
      );
      return value.session;
    },
    async deleteSession(sessionId) {
      unwrap(await ipcCall("coding.session.delete", { sessionId }));
    },
    async archiveSession(sessionId) {
      unwrap(
        await ipcCall("sessions.archive", { pillar: "agents", id: sessionId }),
      );
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
      userRenamed:
        parsed.userRenamed && typeof parsed.userRenamed === "object"
          ? Object.fromEntries(
              Object.entries(parsed.userRenamed).filter((entry) => entry[1] === true),
            )
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

function sessionToChat(
  session: CodingSessionSummaryT,
  folderId: string | null,
  userRenamed = false,
): Chat {
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
    userRenamed,
  };
}

const LEGACY_WORKSPACE_ID = "workspace:legacy";
const LEGACY_UNSORTED_ID = "workspace:legacy:unsorted";

function workspaceFolderId(workspaceId: string): string {
  return `workspace:${workspaceId}`;
}

function folderLabel(path: string, rootCount: number): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const base = trimmed.split(/[\\/]/).pop() || path;
  return rootCount > 1 ? `${base} +${rootCount - 1}` : base;
}

function workspaceTreeState(
  sessions: readonly CodingSessionSummaryT[],
  overlay: FolderOverlay,
): { folders: Folder[]; chats: Chat[] } {
  const uniqueSessions = [
    ...new Map(
      sessions.map((session) => [session.sessionId, session]),
    ).values(),
  ];
  const now = Date.now();
  const folders: Folder[] = [];
  const workspaceIds = new Set<string>();
  let needsLegacy = overlay.folders.length > 0;

  for (const session of uniqueSessions) {
    if (
      !session.workspaceId ||
      !session.workspaceRoots?.length ||
      !session.primaryRoot
    ) {
      needsLegacy = true;
      continue;
    }
    const id = workspaceFolderId(session.workspaceId);
    if (workspaceIds.has(id)) continue;
    workspaceIds.add(id);
    folders.push({
      id,
      parentId: null,
      name: folderLabel(session.primaryRoot, session.workspaceRoots.length),
      color: null,
      icon: session.workspaceRoots.join("\n"),
      createdAt: now,
      updatedAt: now,
    });
  }

  if (needsLegacy) {
    folders.push(
      {
        id: LEGACY_WORKSPACE_ID,
        parentId: null,
        name: "Legacy workspace",
        color: null,
        icon: "Sessions created before workspace tracking",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: LEGACY_UNSORTED_ID,
        parentId: LEGACY_WORKSPACE_ID,
        name: "Unsorted",
        color: null,
        icon: "Migrated local folders and unscoped sessions",
        createdAt: now,
        updatedAt: now,
      },
    );
    folders.push(
      ...overlay.folders.map((folder) => ({
        ...folder,
        parentId: folder.parentId ?? LEGACY_UNSORTED_ID,
      })),
    );
  }

  const overlayIds = new Set(overlay.folders.map((folder) => folder.id));
  const chats = uniqueSessions.map((session) => {
    const durableFolder = session.workspaceId
      ? workspaceFolderId(session.workspaceId)
      : null;
    const legacyFolder = overlay.sessionFolders[session.sessionId];
    const folderId =
      durableFolder && workspaceIds.has(durableFolder)
        ? durableFolder
        : legacyFolder && overlayIds.has(legacyFolder)
          ? legacyFolder
          : LEGACY_UNSORTED_ID;
    return sessionToChat(
      session,
      folderId,
      overlay.userRenamed[session.sessionId] === true,
    );
  });
  return { folders, chats };
}

function buildTree(
  folders: readonly Folder[],
  chats: readonly Chat[],
): FolderTreeNode {
  const byParent = new Map<string | null, Folder[]>();
  for (const folder of folders) {
    const bucket = byParent.get(folder.parentId) ?? [];
    bucket.push(folder);
    byParent.set(folder.parentId, bucket);
  }
  for (const bucket of byParent.values())
    bucket.sort((a, b) => a.name.localeCompare(b.name));
  const chatsByFolder = new Map<string | null, Chat[]>();
  for (const chat of chats) {
    const bucket = chatsByFolder.get(chat.folderId) ?? [];
    bucket.push(chat);
    chatsByFolder.set(chat.folderId, bucket);
  }
  for (const bucket of chatsByFolder.values())
    bucket.sort((a, b) => a.title.localeCompare(b.title));
  const buildNode = (folder: Folder | null): FolderTreeNode => {
    const parentKey = folder?.id ?? null;
    return {
      folder,
      children: (byParent.get(parentKey) ?? []).map((child) =>
        buildNode(child),
      ),
      chats: chatsByFolder.get(parentKey) ?? [],
    };
  };
  return buildNode(null);
}

function isAncestor(
  folders: readonly Folder[],
  ancestorId: string,
  nodeId: string,
): boolean {
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
  getWorkspaceSelection: () => CodingWorkspaceSelection | null;
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
        userRenamed: { ...(opts.initialOverlay.userRenamed ?? {}) },
      }
    : persist
      ? readOverlay(overlayKey)
      : emptyOverlay();

  const save = (): void => {
    if (persist) writeOverlay(overlayKey, overlay);
  };

  const readTreeState = async (): Promise<{
    folders: Folder[];
    chats: Chat[];
  }> => {
    const sessions = await opts.backend.listSessions();
    return workspaceTreeState(sessions, overlay);
  };

  const requireFolder = (id: string): Folder => {
    const folder = overlay.folders.find((row) => row.id === id);
    if (!folder) throw new Error(`folder not found: ${id}`);
    return folder;
  };

  return {
    async listTree() {
      const state = await readTreeState();
      return buildTree(state.folders, state.chats);
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
      const updated: Folder = {
        ...folder,
        name: trimmed,
        updatedAt: Date.now(),
      };
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
      const updated: Folder = {
        ...folder,
        parentId: newParentId,
        updatedAt: Date.now(),
      };
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
        .map((row) =>
          row.parentId === id ? { ...row, parentId: folder.parentId } : row,
        );
      const nextSessionFolders = { ...overlay.sessionFolders };
      for (const [sessionId, folderId] of Object.entries(nextSessionFolders)) {
        if (folderId === id) nextSessionFolders[sessionId] = folder.parentId;
      }
      overlay = {
        folders: nextFolders,
        sessionFolders: nextSessionFolders,
        userRenamed: overlay.userRenamed,
      };
      save();
    },
    async createChat(input) {
      const workspace = opts.getWorkspaceSelection();
      if (!workspace) {
        throw new Error(
          "Choose a workspace folder before starting a coding session.",
        );
      }
      const title = input.title.trim() || "New chat";
      const started = await opts.backend.startSession({
        title,
        modelId: input.modelId || opts.getModelId(),
        workspacePath: workspace.primaryRoot,
        workspaceRoots: workspace.roots,
        primaryRoot: workspace.primaryRoot,
      });
      opts.onSessionCreated?.(started);
      return sessionToChat(
        started,
        started.workspaceId
          ? workspaceFolderId(started.workspaceId)
          : LEGACY_UNSORTED_ID,
        overlay.userRenamed[started.sessionId] === true,
      );
    },
    async renameChat(id, title, byUser) {
      const trimmed = title.trim();
      if (!trimmed) throw new Error("session title is required");
      if (byUser === true) {
        overlay = {
          ...overlay,
          userRenamed: { ...overlay.userRenamed, [id]: true },
        };
        save();
      }
      const renamed = await opts.backend.renameSession(id, trimmed);
      return sessionToChat(
        renamed,
        renamed.workspaceId
          ? workspaceFolderId(renamed.workspaceId)
          : (overlay.sessionFolders[id] ?? LEGACY_UNSORTED_ID),
        overlay.userRenamed[id] === true,
      );
    },
    async moveChat(id, newFolderId) {
      if (newFolderId !== null) requireFolder(newFolderId);
      overlay = {
        ...overlay,
        sessionFolders: { ...overlay.sessionFolders, [id]: newFolderId },
      };
      save();
      const chats = (await readTreeState()).chats;
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
    async archiveChat(id) {
      if (!opts.backend.archiveSession)
        throw new Error("Archive is unavailable.");
      await opts.backend.archiveSession(id);
      const nextSessionFolders = { ...overlay.sessionFolders };
      delete nextSessionFolders[id];
      overlay = { ...overlay, sessionFolders: nextSessionFolders };
      save();
    },
    async getFolder(id) {
      const state = await readTreeState();
      return state.folders.find((folder) => folder.id === id) ?? null;
    },
    async getChat(id) {
      const chats = (await readTreeState()).chats;
      return chats.find((row) => row.id === id) ?? null;
    },
    async ancestors(folderId) {
      if (folderId === null) return [];
      const state = await readTreeState();
      const byId = new Map(state.folders.map((folder) => [folder.id, folder]));
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
      const state = await readTreeState();
      const tree = buildTree(state.folders, state.chats);
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
