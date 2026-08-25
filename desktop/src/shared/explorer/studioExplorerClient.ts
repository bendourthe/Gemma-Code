/**
 * v2.2.6 Phase 1 -- pillar-scoped studio explorer client (no Chat types).
 */

import type {
  AppendStudioTurnInput,
  StudioFolder,
  StudioSession,
  StudioTreeNode,
  StudioTurn,
} from "../../../../core/generations/StudioSessionStore.types";

export type MaybeAsync<T> = T | Promise<T>;

export interface StudioExplorerClient {
  listTree(): MaybeAsync<StudioTreeNode>;
  createFolder(input: { parentId: string | null; name: string }): MaybeAsync<StudioFolder>;
  renameFolder(id: string, name: string): MaybeAsync<StudioFolder>;
  moveFolder(id: string, newParentId: string | null): MaybeAsync<StudioFolder>;
  deleteFolder(id: string): MaybeAsync<void>;
  createSession(input: {
    folderId: string | null;
    title: string;
    modelId: string;
  }): MaybeAsync<StudioSession>;
  renameSession(id: string, title: string): MaybeAsync<StudioSession>;
  moveSession(id: string, newFolderId: string | null): MaybeAsync<StudioSession>;
  deleteSession(id: string): MaybeAsync<void>;
  getFolder(id: string): MaybeAsync<StudioFolder | null>;
  getSession(id: string): MaybeAsync<StudioSession | null>;
  ancestors(folderId: string | null): MaybeAsync<readonly StudioFolder[]>;
  appendTurn?(input: AppendStudioTurnInput): MaybeAsync<StudioTurn>;
  listTurns?(sessionId: string, limit?: number): MaybeAsync<readonly StudioTurn[]>;
}

function makeId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `id-${Math.random().toString(36).slice(2, 12)}-${Date.now().toString(36)}`;
}

/** In-memory client for tests and for sidecar-down (empty tree, no fake sessions). */
export class InMemoryStudioExplorerClient implements StudioExplorerClient {
  private readonly folders = new Map<string, StudioFolder>();
  private readonly sessions = new Map<string, StudioSession>();
  private readonly turns = new Map<string, StudioTurn[]>();

  constructor(private readonly pillar: "image" | "video") {}

  listTree(): StudioTreeNode {
    const byParent = new Map<string | null, StudioFolder[]>();
    for (const folder of this.folders.values()) {
      const bucket = byParent.get(folder.parentId) ?? [];
      bucket.push(folder);
      byParent.set(folder.parentId, bucket);
    }
    for (const bucket of byParent.values()) bucket.sort((a, b) => a.name.localeCompare(b.name));
    const sessionsByFolder = new Map<string | null, StudioSession[]>();
    for (const session of this.sessions.values()) {
      const bucket = sessionsByFolder.get(session.folderId) ?? [];
      bucket.push(session);
      sessionsByFolder.set(session.folderId, bucket);
    }
    for (const bucket of sessionsByFolder.values()) {
      bucket.sort((a, b) => a.title.localeCompare(b.title));
    }
    const build = (folder: StudioFolder | null): StudioTreeNode => {
      const key = folder?.id ?? null;
      return {
        folder,
        children: (byParent.get(key) ?? []).map((child) => build(child)),
        sessions: sessionsByFolder.get(key) ?? [],
      };
    };
    return build(null);
  }

  createFolder(input: { parentId: string | null; name: string }): StudioFolder {
    const name = input.name.trim();
    if (!name) throw new Error("folder name is required");
    if (input.parentId !== null && !this.folders.has(input.parentId)) {
      throw new Error(`parent folder not found: ${input.parentId}`);
    }
    const now = Date.now();
    const folder: StudioFolder = {
      id: makeId(),
      pillar: this.pillar,
      parentId: input.parentId,
      name,
      createdAt: now,
      updatedAt: now,
    };
    this.folders.set(folder.id, folder);
    return folder;
  }

  renameFolder(id: string, name: string): StudioFolder {
    const trimmed = name.trim();
    if (!trimmed) throw new Error("folder name is required");
    const folder = this.folders.get(id);
    if (!folder) throw new Error(`folder not found: ${id}`);
    const updated = { ...folder, name: trimmed, updatedAt: Date.now() };
    this.folders.set(id, updated);
    return updated;
  }

  moveFolder(id: string, newParentId: string | null): StudioFolder {
    const folder = this.folders.get(id);
    if (!folder) throw new Error(`folder not found: ${id}`);
    if (newParentId === id) throw new Error("cannot move folder into itself");
    if (newParentId !== null && !this.folders.has(newParentId)) {
      throw new Error(`new parent folder not found: ${newParentId}`);
    }
    const updated = { ...folder, parentId: newParentId, updatedAt: Date.now() };
    this.folders.set(id, updated);
    return updated;
  }

  deleteFolder(id: string): void {
    const doomed = new Set<string>();
    const stack = [id];
    while (stack.length > 0) {
      const current = stack.pop()!;
      doomed.add(current);
      for (const folder of this.folders.values()) {
        if (folder.parentId === current) stack.push(folder.id);
      }
    }
    for (const session of [...this.sessions.values()]) {
      if (session.folderId !== null && doomed.has(session.folderId)) {
        this.sessions.delete(session.id);
        this.turns.delete(session.id);
      }
    }
    for (const fid of doomed) this.folders.delete(fid);
  }

  createSession(input: { folderId: string | null; title: string; modelId: string }): StudioSession {
    const title = input.title.trim();
    if (!title) throw new Error("session title is required");
    if (!input.modelId.trim()) throw new Error("session modelId is required");
    if (input.folderId !== null && !this.folders.has(input.folderId)) {
      throw new Error(`folder not found: ${input.folderId}`);
    }
    const now = Date.now();
    const session: StudioSession = {
      id: makeId(),
      pillar: this.pillar,
      folderId: input.folderId,
      title,
      modelId: input.modelId.trim(),
      lastOutputRef: null,
      createdAt: now,
      updatedAt: now,
      turnCount: 0,
    };
    this.sessions.set(session.id, session);
    this.turns.set(session.id, []);
    return session;
  }

  renameSession(id: string, title: string): StudioSession {
    const trimmed = title.trim();
    if (!trimmed) throw new Error("session title is required");
    const session = this.sessions.get(id);
    if (!session) throw new Error(`session not found: ${id}`);
    const updated = { ...session, title: trimmed, updatedAt: Date.now() };
    this.sessions.set(id, updated);
    return updated;
  }

  moveSession(id: string, newFolderId: string | null): StudioSession {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`session not found: ${id}`);
    if (newFolderId !== null && !this.folders.has(newFolderId)) {
      throw new Error(`folder not found: ${newFolderId}`);
    }
    const updated = { ...session, folderId: newFolderId, updatedAt: Date.now() };
    this.sessions.set(id, updated);
    return updated;
  }

  deleteSession(id: string): void {
    this.sessions.delete(id);
    this.turns.delete(id);
  }

  getFolder(id: string): StudioFolder | null {
    return this.folders.get(id) ?? null;
  }

  getSession(id: string): StudioSession | null {
    return this.sessions.get(id) ?? null;
  }

  ancestors(folderId: string | null): readonly StudioFolder[] {
    const chain: StudioFolder[] = [];
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

  appendTurn(input: AppendStudioTurnInput): StudioTurn {
    const session = this.sessions.get(input.sessionId);
    if (!session) throw new Error(`session not found: ${input.sessionId}`);
    const now = input.createdAt ?? Date.now();
    const turn: StudioTurn = {
      id: input.id ?? makeId(),
      sessionId: input.sessionId,
      role: input.role,
      content: input.content,
      mediaRef: input.mediaRef ?? null,
      createdAt: now,
      inputTokens: input.inputTokens,
      reasoningTokens: input.reasoningTokens,
      outputTokens: input.outputTokens,
      tokensEstimated: input.tokensEstimated,
      visualUnits: input.visualUnits,
    };
    const list = this.turns.get(input.sessionId) ?? [];
    list.push(turn);
    this.turns.set(input.sessionId, list);
    this.sessions.set(input.sessionId, {
      ...session,
      turnCount: session.turnCount + 1,
      lastOutputRef:
        input.role === "assistant" && turn.mediaRef ? turn.mediaRef : session.lastOutputRef,
      updatedAt: now,
    });
    return turn;
  }

  listTurns(sessionId: string, limit = 500): readonly StudioTurn[] {
    return (this.turns.get(sessionId) ?? []).slice(0, limit);
  }
}
