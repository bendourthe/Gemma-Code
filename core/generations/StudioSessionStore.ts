/**
 * v2.2.6 Phase 1 -- SQLite store for named Image/Video studio sessions.
 *
 * Mirrors the Chat explorer folder/session/turn shape without sharing the
 * Chatbot schema. `lastOutputRef` and turn `mediaRef` are paths only.
 * Missing pillar rejects create. Corrupt optional JSON on a row is skipped
 * so one bad session cannot crash the tree. Delete wins over rename.
 */

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import BetterSqlite from "better-sqlite3";
import type Database from "better-sqlite3";
import { isStudioPillar, type StudioPillar } from "./StudioSessionStore.types.js";
import type {
  AppendStudioTurnInput,
  CreateStudioFolderInput,
  CreateStudioSessionInput,
  StudioFolder,
  StudioSession,
  StudioTreeNode,
  StudioTurn,
} from "./StudioSessionStore.types.js";

const MAX_PATH_REF = 4096;

interface FolderRow {
  id: string;
  pillar: string;
  parent_id: string | null;
  name: string;
  color: string | null;
  icon: string | null;
  extra_json: string | null;
  created_at: number;
  updated_at: number;
}

interface SessionRow {
  id: string;
  pillar: string;
  folder_id: string | null;
  title: string;
  model_id: string;
  last_output_ref: string | null;
  extra_json: string | null;
  created_at: number;
  updated_at: number;
  turn_count: number;
}

interface TurnRow {
  id: string;
  session_id: string;
  role: string;
  content: string;
  media_ref: string | null;
  extra_json: string | null;
  created_at: number;
}

function assertPillar(value: unknown): StudioPillar {
  if (!isStudioPillar(value)) {
    throw new Error("studio pillar is required (image or video)");
  }
  return value;
}

function assertPathRef(ref: string | null | undefined): string | null {
  if (ref == null || ref === "") return null;
  const trimmed = ref.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("data:")) {
    throw new Error("mediaRef must be a path, not an inline blob");
  }
  if (trimmed.length > MAX_PATH_REF) {
    throw new Error("mediaRef path is too long");
  }
  return trimmed;
}

function extraJsonOk(raw: string | null): boolean {
  if (raw == null || raw === "") return true;
  try {
    JSON.parse(raw);
    return true;
  } catch {
    return false;
  }
}

function rowToFolder(row: FolderRow): StudioFolder | null {
  if (!isStudioPillar(row.pillar)) return null;
  if (!extraJsonOk(row.extra_json)) return null;
  return {
    id: row.id,
    pillar: row.pillar,
    parentId: row.parent_id,
    name: row.name,
    color: row.color,
    icon: row.icon,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToSession(row: SessionRow): StudioSession | null {
  if (!isStudioPillar(row.pillar)) return null;
  if (!extraJsonOk(row.extra_json)) return null;
  return {
    id: row.id,
    pillar: row.pillar,
    folderId: row.folder_id,
    title: row.title,
    modelId: row.model_id,
    lastOutputRef: row.last_output_ref,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    turnCount: row.turn_count,
  };
}

function rowToTurn(row: TurnRow): StudioTurn | null {
  if (!extraJsonOk(row.extra_json)) return null;
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role === "assistant" ? "assistant" : "user",
    content: row.content,
    mediaRef: row.media_ref,
    createdAt: row.created_at,
  };
}

export class StudioSessionStore {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    if (dbPath !== ":memory:") {
      mkdirSync(dirname(dbPath), { recursive: true });
    }
    this.db = new BetterSqlite(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS studio_folders (
        id          TEXT    PRIMARY KEY,
        pillar      TEXT    NOT NULL,
        parent_id   TEXT             REFERENCES studio_folders(id) ON DELETE CASCADE,
        name        TEXT    NOT NULL,
        color       TEXT,
        icon        TEXT,
        extra_json  TEXT,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_studio_folders_pillar_parent
        ON studio_folders(pillar, parent_id);

      CREATE TABLE IF NOT EXISTS studio_sessions (
        id               TEXT    PRIMARY KEY,
        pillar           TEXT    NOT NULL,
        folder_id        TEXT             REFERENCES studio_folders(id) ON DELETE CASCADE,
        title            TEXT    NOT NULL,
        model_id         TEXT    NOT NULL,
        last_output_ref  TEXT,
        extra_json       TEXT,
        created_at       INTEGER NOT NULL,
        updated_at       INTEGER NOT NULL,
        turn_count       INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_studio_sessions_pillar_folder
        ON studio_sessions(pillar, folder_id);

      CREATE TABLE IF NOT EXISTS studio_turns (
        id          TEXT    PRIMARY KEY,
        session_id  TEXT    NOT NULL REFERENCES studio_sessions(id) ON DELETE CASCADE,
        role        TEXT    NOT NULL,
        content     TEXT    NOT NULL,
        media_ref   TEXT,
        extra_json  TEXT,
        created_at  INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_studio_turns_session
        ON studio_turns(session_id, created_at);
    `);
  }

  close(): void {
    this.db.close();
  }

  createFolder(input: CreateStudioFolderInput): StudioFolder {
    const pillar = assertPillar(input.pillar);
    const name = input.name.trim();
    if (!name) throw new Error("folder name is required");
    if (input.parentId !== null) {
      const parent = this.getFolderRow(input.parentId);
      if (!parent) throw new Error(`parent folder not found: ${input.parentId}`);
      if (parent.pillar !== pillar) throw new Error("parent folder pillar mismatch");
    }
    const id = randomUUID();
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO studio_folders
           (id, pillar, parent_id, name, color, icon, extra_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
      )
      .run(id, pillar, input.parentId, name, input.color ?? null, input.icon ?? null, now, now);
    return {
      id,
      pillar,
      parentId: input.parentId,
      name,
      color: input.color ?? null,
      icon: input.icon ?? null,
      createdAt: now,
      updatedAt: now,
    };
  }

  renameFolder(id: string, name: string): StudioFolder {
    const trimmed = name.trim();
    if (!trimmed) throw new Error("folder name is required");
    const existing = this.getFolderRow(id);
    if (!existing) throw new Error(`folder not found: ${id}`);
    const now = Date.now();
    this.db.prepare(`UPDATE studio_folders SET name = ?, updated_at = ? WHERE id = ?`).run(trimmed, now, id);
    const mapped = rowToFolder({ ...existing, name: trimmed, updated_at: now });
    if (!mapped) throw new Error(`folder not found: ${id}`);
    return mapped;
  }

  moveFolder(id: string, newParentId: string | null): StudioFolder {
    const existing = this.getFolderRow(id);
    if (!existing) throw new Error(`folder not found: ${id}`);
    if (newParentId === id) throw new Error("cannot move folder into itself");
    if (newParentId !== null) {
      const parent = this.getFolderRow(newParentId);
      if (!parent) throw new Error(`new parent folder not found: ${newParentId}`);
      if (parent.pillar !== existing.pillar) throw new Error("parent folder pillar mismatch");
      if (this.isAncestor(id, newParentId)) {
        throw new Error("cannot move folder into its own descendant");
      }
    }
    const now = Date.now();
    this.db
      .prepare(`UPDATE studio_folders SET parent_id = ?, updated_at = ? WHERE id = ?`)
      .run(newParentId, now, id);
    const mapped = rowToFolder({ ...existing, parent_id: newParentId, updated_at: now });
    if (!mapped) throw new Error(`folder not found: ${id}`);
    return mapped;
  }

  deleteFolder(id: string): void {
    const existing = this.getFolderRow(id);
    if (!existing) return;
    this.db.prepare(`DELETE FROM studio_folders WHERE id = ?`).run(id);
  }

  getFolder(id: string): StudioFolder | null {
    const row = this.getFolderRow(id);
    return row ? rowToFolder(row) : null;
  }

  createSession(input: CreateStudioSessionInput): StudioSession {
    const pillar = assertPillar(input.pillar);
    const title = input.title.trim();
    if (!title) throw new Error("session title is required");
    if (!input.modelId.trim()) throw new Error("session modelId is required");
    if (input.folderId !== null) {
      const folder = this.getFolderRow(input.folderId);
      if (!folder) throw new Error(`folder not found: ${input.folderId}`);
      if (folder.pillar !== pillar) throw new Error("folder pillar mismatch");
    }
    const id = randomUUID();
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO studio_sessions
           (id, pillar, folder_id, title, model_id, last_output_ref, extra_json, created_at, updated_at, turn_count)
         VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, 0)`,
      )
      .run(id, pillar, input.folderId, title, input.modelId.trim(), now, now);
    return {
      id,
      pillar,
      folderId: input.folderId,
      title,
      modelId: input.modelId.trim(),
      lastOutputRef: null,
      createdAt: now,
      updatedAt: now,
      turnCount: 0,
    };
  }

  renameSession(id: string, title: string): StudioSession {
    const trimmed = title.trim();
    if (!trimmed) throw new Error("session title is required");
    const existing = this.getSessionRow(id);
    if (!existing) throw new Error(`session not found: ${id}`);
    const now = Date.now();
    this.db.prepare(`UPDATE studio_sessions SET title = ?, updated_at = ? WHERE id = ?`).run(trimmed, now, id);
    const mapped = rowToSession({ ...existing, title: trimmed, updated_at: now });
    if (!mapped) throw new Error(`session not found: ${id}`);
    return mapped;
  }

  moveSession(id: string, newFolderId: string | null): StudioSession {
    const existing = this.getSessionRow(id);
    if (!existing) throw new Error(`session not found: ${id}`);
    if (newFolderId !== null) {
      const folder = this.getFolderRow(newFolderId);
      if (!folder) throw new Error(`folder not found: ${newFolderId}`);
      if (folder.pillar !== existing.pillar) throw new Error("folder pillar mismatch");
    }
    const now = Date.now();
    this.db
      .prepare(`UPDATE studio_sessions SET folder_id = ?, updated_at = ? WHERE id = ?`)
      .run(newFolderId, now, id);
    const mapped = rowToSession({ ...existing, folder_id: newFolderId, updated_at: now });
    if (!mapped) throw new Error(`session not found: ${id}`);
    return mapped;
  }

  deleteSession(id: string): void {
    this.db.prepare(`DELETE FROM studio_sessions WHERE id = ?`).run(id);
  }

  getSession(id: string): StudioSession | null {
    const row = this.getSessionRow(id);
    return row ? rowToSession(row) : null;
  }

  appendTurn(input: AppendStudioTurnInput): StudioTurn {
    const existing = this.getSessionRow(input.sessionId);
    if (!existing) throw new Error(`session not found: ${input.sessionId}`);
    const mediaRef = assertPathRef(input.mediaRef);
    const now = input.createdAt ?? Date.now();
    const id = input.id ?? randomUUID();
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO studio_turns
             (id, session_id, role, content, media_ref, extra_json, created_at)
           VALUES (?, ?, ?, ?, ?, NULL, ?)`,
        )
        .run(id, input.sessionId, input.role, input.content, mediaRef, now);
      if (input.role === "assistant" && mediaRef) {
        this.db
          .prepare(
            `UPDATE studio_sessions
               SET turn_count = turn_count + 1, last_output_ref = ?, updated_at = ?
             WHERE id = ?`,
          )
          .run(mediaRef, now, input.sessionId);
      } else {
        this.db
          .prepare(
            `UPDATE studio_sessions
               SET turn_count = turn_count + 1, updated_at = ?
             WHERE id = ?`,
          )
          .run(now, input.sessionId);
      }
    });
    tx();
    return {
      id,
      sessionId: input.sessionId,
      role: input.role,
      content: input.content,
      mediaRef,
      createdAt: now,
    };
  }

  listTurns(sessionId: string, limit = 500): readonly StudioTurn[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM studio_turns WHERE session_id = ?
         ORDER BY created_at ASC, rowid ASC LIMIT ?`,
      )
      .all(sessionId, limit) as TurnRow[];
    const out: StudioTurn[] = [];
    for (const row of rows) {
      const mapped = rowToTurn(row);
      if (mapped) out.push(mapped);
      else console.warn(`studio-session: skipping corrupt turn ${row.id}`);
    }
    return out;
  }

  listTree(pillar: StudioPillar): StudioTreeNode {
    assertPillar(pillar);
    const folderRows = this.db
      .prepare<unknown[], FolderRow>(
        `SELECT * FROM studio_folders WHERE pillar = ? ORDER BY name ASC`,
      )
      .all(pillar);
    const sessionRows = this.db
      .prepare<unknown[], SessionRow>(
        `SELECT * FROM studio_sessions WHERE pillar = ? ORDER BY title ASC`,
      )
      .all(pillar);
    const byParent = new Map<string | null, StudioFolder[]>();
    for (const row of folderRows) {
      const folder = rowToFolder(row);
      if (!folder) {
        console.warn(`studio-session: skipping corrupt folder ${row.id}`);
        continue;
      }
      const bucket = byParent.get(folder.parentId) ?? [];
      bucket.push(folder);
      byParent.set(folder.parentId, bucket);
    }
    const sessionsByFolder = new Map<string | null, StudioSession[]>();
    for (const row of sessionRows) {
      const session = rowToSession(row);
      if (!session) {
        console.warn(`studio-session: skipping corrupt session ${row.id}`);
        continue;
      }
      const bucket = sessionsByFolder.get(session.folderId) ?? [];
      bucket.push(session);
      sessionsByFolder.set(session.folderId, bucket);
    }
    const buildNode = (folder: StudioFolder | null): StudioTreeNode => {
      const parentKey = folder?.id ?? null;
      return {
        folder,
        children: (byParent.get(parentKey) ?? []).map((child) => buildNode(child)),
        sessions: sessionsByFolder.get(parentKey) ?? [],
      };
    };
    return buildNode(null);
  }

  ancestors(folderId: string | null): readonly StudioFolder[] {
    const chain: StudioFolder[] = [];
    let cursor: string | null = folderId;
    const seen = new Set<string>();
    while (cursor !== null) {
      if (seen.has(cursor)) break;
      seen.add(cursor);
      const row = this.getFolderRow(cursor);
      if (!row) break;
      const mapped = rowToFolder(row);
      if (!mapped) break;
      chain.push(mapped);
      cursor = row.parent_id;
    }
    return chain.reverse();
  }

  /** Test seam: write a raw extra_json blob (used to prove corrupt rows are skipped). */
  unsafeSetSessionExtraJson(id: string, extraJson: string): void {
    this.db.prepare(`UPDATE studio_sessions SET extra_json = ? WHERE id = ?`).run(extraJson, id);
  }

  private getFolderRow(id: string): FolderRow | undefined {
    return this.db.prepare<[string], FolderRow>(`SELECT * FROM studio_folders WHERE id = ?`).get(id);
  }

  private getSessionRow(id: string): SessionRow | undefined {
    return this.db.prepare<[string], SessionRow>(`SELECT * FROM studio_sessions WHERE id = ?`).get(id);
  }

  private isAncestor(ancestorId: string, maybeDescendantId: string): boolean {
    let cursor: string | null = maybeDescendantId;
    const seen = new Set<string>();
    while (cursor !== null) {
      if (seen.has(cursor)) return false;
      seen.add(cursor);
      const row = this.getFolderRow(cursor);
      if (!row) return false;
      if (row.parent_id === ancestorId) return true;
      cursor = row.parent_id;
    }
    return false;
  }
}
