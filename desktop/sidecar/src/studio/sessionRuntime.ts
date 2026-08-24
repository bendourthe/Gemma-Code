/**
 * v2.2.6 Phase 1 -- sidecar runtime for `studio.session.*`.
 *
 * Lazily opens `~/.nexus/generations/sessions.db`. A failed open is a typed
 * storage error, not an empty tree (empty and broken look the same to a user).
 */

import * as path from "node:path";
import { mkdirSync } from "node:fs";

import { StudioSessionStore } from "../../../../core/generations/StudioSessionStore.js";
import { resolveSessionsDbPath } from "../../../../core/generations/paths.js";
import type {
  AppendStudioTurnInput,
  CreateStudioFolderInput,
  CreateStudioSessionInput,
  StudioFolder,
  StudioSession,
  StudioTreeNode,
  StudioTurn,
  StudioPillar,
} from "../../../../core/generations/StudioSessionStore.types.js";

export function resolveStudioSessionsDbPath(homeDirFn?: () => string): string {
  return resolveSessionsDbPath(homeDirFn);
}

export class StudioSessionStorageUnavailableError extends Error {
  readonly dbPath: string;
  constructor(dbPath: string, cause: string) {
    super(`studio-session-storage-unavailable: ${cause}`);
    this.name = "StudioSessionStorageUnavailableError";
    this.dbPath = dbPath;
  }
}

export interface StudioSessionRuntime {
  readonly store: StudioSessionStore;
  readonly dbPath: string;
}

let runtime: StudioSessionRuntime | null = null;
let failure: StudioSessionStorageUnavailableError | null = null;

export function studioSessionRuntime(
  dbPath = resolveStudioSessionsDbPath(),
): StudioSessionRuntime {
  if (failure) throw failure;
  if (runtime) return runtime;
  try {
    if (dbPath !== ":memory:") {
      mkdirSync(path.dirname(dbPath), { recursive: true });
    }
    runtime = { store: new StudioSessionStore(dbPath), dbPath };
    return runtime;
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    failure = new StudioSessionStorageUnavailableError(dbPath, cause);
    throw failure;
  }
}

export function resetStudioSessionRuntime(): void {
  try {
    runtime?.store.close();
  } catch {
    /* best-effort */
  }
  runtime = null;
  failure = null;
}

export interface StudioSessionOps {
  tree(input: { pillar: StudioPillar }): { tree: StudioTreeNode };
  createFolder(input: CreateStudioFolderInput): StudioFolder;
  renameFolder(input: { id: string; name: string }): StudioFolder;
  moveFolder(input: { id: string; parentId: string | null }): StudioFolder;
  deleteFolder(input: { id: string }): { ok: true };
  createSession(input: CreateStudioSessionInput): StudioSession;
  renameSession(input: { id: string; title: string }): StudioSession;
  moveSession(input: { id: string; folderId: string | null }): StudioSession;
  deleteSession(input: { id: string }): { ok: true };
  appendTurn(input: AppendStudioTurnInput): StudioTurn;
  listTurns(input: { sessionId: string; limit?: number }): { turns: readonly StudioTurn[] };
}

export function createStudioSessionOps(
  sessionRuntime: StudioSessionRuntime = studioSessionRuntime(),
): StudioSessionOps {
  const { store } = sessionRuntime;
  return {
    tree: (input) => ({ tree: store.listTree(input.pillar) }),
    createFolder: (input) => store.createFolder(input),
    renameFolder: (input) => store.renameFolder(input.id, input.name),
    moveFolder: (input) => store.moveFolder(input.id, input.parentId),
    deleteFolder: (input) => {
      store.deleteFolder(input.id);
      return { ok: true };
    },
    createSession: (input) => store.createSession(input),
    renameSession: (input) => store.renameSession(input.id, input.title),
    moveSession: (input) => store.moveSession(input.id, input.folderId),
    deleteSession: (input) => {
      store.deleteSession(input.id);
      return { ok: true };
    },
    appendTurn: (input) => store.appendTurn(input),
    listTurns: (input) => ({
      turns: store.listTurns(input.sessionId, input.limit ?? 500),
    }),
  };
}
