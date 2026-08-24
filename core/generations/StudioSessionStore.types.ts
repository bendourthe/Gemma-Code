/**
 * v2.2.6 Phase 1 -- types for named Image/Video studio sessions.
 *
 * Kept out of the SQLite store module so the desktop renderer can import the
 * shape without pulling `better-sqlite3` into the Vite bundle. Chatbot keeps
 * `chat.explorer.*` and Chat types; this surface is pillar-scoped.
 */

export type StudioPillar = "image" | "video";

export const STUDIO_PILLARS: readonly StudioPillar[] = ["image", "video"];

export function isStudioPillar(value: unknown): value is StudioPillar {
  return value === "image" || value === "video";
}

export interface StudioFolder {
  id: string;
  pillar: StudioPillar;
  parentId: string | null;
  name: string;
  createdAt: number;
  updatedAt: number;
  color?: string | null;
  icon?: string | null;
}

export interface StudioSession {
  id: string;
  pillar: StudioPillar;
  folderId: string | null;
  title: string;
  modelId: string;
  /** Generations-index path or PNG/MP4 path. Never a blob. */
  lastOutputRef: string | null;
  createdAt: number;
  updatedAt: number;
  turnCount: number;
}

export interface StudioTurn {
  id: string;
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  /** Path to media on disk, or null. Never a giant blob. */
  mediaRef: string | null;
  createdAt: number;
}

export interface StudioTreeNode {
  folder: StudioFolder | null;
  children: StudioTreeNode[];
  sessions: StudioSession[];
}

export interface CreateStudioFolderInput {
  pillar: StudioPillar;
  parentId: string | null;
  name: string;
  color?: string | null;
  icon?: string | null;
}

export interface CreateStudioSessionInput {
  pillar: StudioPillar;
  folderId: string | null;
  title: string;
  modelId: string;
}

export interface AppendStudioTurnInput {
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  mediaRef?: string | null;
  id?: string;
  createdAt?: number;
}
