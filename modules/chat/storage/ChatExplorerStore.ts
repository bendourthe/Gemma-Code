/**
 * v1.0.0 Phase 4.1 -- ChatExplorerStore.
 *
 * SQLite-backed store for nested chat folders and chats, with FTS5 search
 * over folder names and chat titles. Backed by the migration in
 * `core/memory/migrations/0001_chat_explorer.sql`. The actual chat message
 * persistence is delegated to the existing `ChatHistoryStore` and is keyed
 * on `Chat.id`; this store only owns the folder/chat hierarchy and the
 * per-chat metadata used by the explorer UI.
 *
 * The store is constructed against an arbitrary `dbPath` (including the
 * `:memory:` sentinel for tests). It is safe to construct multiple stores
 * against different paths in the same process.
 */

import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import { redactSecrets } from "../../../core/observability/redactSecrets.js";
import { sanitizeFtsQuery } from "../../../src/storage/embeddingUtils.js";
import { createFtsTableAndTriggers } from "../../../src/storage/sqliteFts.js";
import { secureDbPermissions } from "../../../src/storage/dbPermissions.js";
import type {
  AppendMessageInput,
  Chat,
  ChatExplorerSearchHit,
  ChatMessageRecord,
  CreateChatInput,
  CreateFolderInput,
  Folder,
  FolderTreeNode,
} from "./ChatExplorerStore.types.js";

const SCHEMA_VERSION = 2;

interface FolderRow {
  id: string;
  parent_id: string | null;
  name: string;
  color: string | null;
  icon: string | null;
  created_at: number;
  updated_at: number;
}

interface ChatRow {
  id: string;
  folder_id: string | null;
  title: string;
  model_id: string;
  context_scope_id: string | null;
  created_at: number;
  updated_at: number;
  message_count: number;
  // v2.2.0 Phase 5: added by the v2 migration; older databases return
  // undefined for these until the ALTER runs, hence the optional types.
  persona?: string | null;
  user_renamed?: number;
  archived_at?: number | null;
  archived_folder_id?: string | null;
}

interface MessageRow {
  id: string;
  chat_id: string;
  role: string;
  content: string;
  attachments: string | null;
  created_at: number;
  input_tokens?: number | null;
  reasoning_tokens?: number | null;
  reasoning_text?: string | null;
  output_tokens?: number | null;
  tokens_estimated?: number | null;
}

function rowToFolder(row: FolderRow): Folder {
  return {
    id: row.id,
    parentId: row.parent_id,
    name: row.name,
    color: row.color,
    icon: row.icon,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToChat(row: ChatRow): Chat {
  return {
    id: row.id,
    folderId: row.folder_id,
    title: row.title,
    modelId: row.model_id,
    contextScopeId: row.context_scope_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messageCount: row.message_count,
    persona: row.persona ?? null,
    // SQLite has no boolean; 1 means the user renamed this chat by hand and
    // auto-titling must never overwrite it.
    userRenamed: row.user_renamed === 1,
    archivedAt: row.archived_at ?? null,
    archivedFolderId: row.archived_folder_id ?? null,
  };
}

function nullableInt(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function rowToMessage(row: MessageRow): ChatMessageRecord {
  let attachments: string[] = [];
  if (row.attachments) {
    try {
      const parsed: unknown = JSON.parse(row.attachments);
      if (Array.isArray(parsed)) attachments = parsed.filter((a): a is string => typeof a === "string");
    } catch {
      // A corrupt attachments blob must not make the whole message unreadable.
      attachments = [];
    }
  }
  return {
    id: row.id,
    chatId: row.chat_id,
    role: row.role === "assistant" ? "assistant" : "user",
    content: row.content,
    attachments,
    createdAt: row.created_at,
    inputTokens: nullableInt(row.input_tokens),
    reasoningTokens: nullableInt(row.reasoning_tokens),
    reasoningText: row.reasoning_text ?? null,
    outputTokens: nullableInt(row.output_tokens),
    tokensEstimated: row.tokens_estimated === 1,
  };
}

export class ChatExplorerStore {
  private readonly _db: Database.Database;

  constructor(dbPath: string) {
    this._db = new Database(dbPath);
    if (dbPath !== ":memory:") {
      secureDbPermissions(dbPath);
    }
    this._db.pragma("journal_mode = WAL");
    this._db.pragma("foreign_keys = ON");
    this._initSchema();
  }

  private _initSchema(): void {
    this._db.exec(`
      CREATE TABLE IF NOT EXISTS chat_folders (
        id          TEXT    PRIMARY KEY,
        parent_id   TEXT             REFERENCES chat_folders(id) ON DELETE CASCADE,
        name        TEXT    NOT NULL,
        color       TEXT,
        icon        TEXT,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_chat_folders_parent ON chat_folders(parent_id);

      CREATE TABLE IF NOT EXISTS chat_chats (
        id                TEXT    PRIMARY KEY,
        folder_id         TEXT             REFERENCES chat_folders(id) ON DELETE CASCADE,
        title             TEXT    NOT NULL,
        model_id          TEXT    NOT NULL,
        context_scope_id  TEXT,
        created_at        INTEGER NOT NULL,
        updated_at        INTEGER NOT NULL,
        message_count     INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_chat_chats_folder ON chat_chats(folder_id);
      CREATE INDEX IF NOT EXISTS idx_chat_chats_scope  ON chat_chats(context_scope_id);

      -- v2.2.0 Phase 5: message turns. Before this the desktop chat held
      -- messages in a React Map, so every conversation was lost on reload.
      CREATE TABLE IF NOT EXISTS chat_chat_messages (
        id          TEXT    PRIMARY KEY,
        chat_id     TEXT    NOT NULL REFERENCES chat_chats(id) ON DELETE CASCADE,
        role        TEXT    NOT NULL,
        content     TEXT    NOT NULL,
        attachments TEXT,
        created_at  INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_chat_messages_chat
        ON chat_chat_messages(chat_id, created_at);
    `);

    // v2.2.0 Phase 5: additive columns. SQLite has no `ADD COLUMN IF NOT
    // EXISTS`, so probe the table and add only what is missing -- this keeps
    // the constructor idempotent on an already-migrated database.
    this._addColumnIfMissing("chat_chats", "persona", "TEXT");
    this._addColumnIfMissing("chat_chats", "user_renamed", "INTEGER NOT NULL DEFAULT 0");
    this._addColumnIfMissing("chat_chats", "archived_at", "INTEGER");
    this._addColumnIfMissing("chat_chats", "archived_folder_id", "TEXT");
    this._addColumnIfMissing("chat_chat_messages", "input_tokens", "INTEGER");
    this._addColumnIfMissing("chat_chat_messages", "reasoning_tokens", "INTEGER");
    this._addColumnIfMissing("chat_chat_messages", "reasoning_text", "TEXT");
    this._addColumnIfMissing("chat_chat_messages", "output_tokens", "INTEGER");
    this._addColumnIfMissing("chat_chat_messages", "tokens_estimated", "INTEGER NOT NULL DEFAULT 0");

    createFtsTableAndTriggers(this._db, {
      ftsTable: "chat_folders_fts",
      contentTable: "chat_folders",
      columns: ["name"],
      triggerPrefix: "chat_folders_fts",
    });
    createFtsTableAndTriggers(this._db, {
      ftsTable: "chat_chats_fts",
      contentTable: "chat_chats",
      columns: ["title"],
      triggerPrefix: "chat_chats_fts",
    });

    const currentVersion = this._db.pragma("user_version", {
      simple: true,
    }) as number;
    if (currentVersion !== SCHEMA_VERSION) {
      try {
        this._db.exec("INSERT INTO chat_folders_fts(chat_folders_fts) VALUES('rebuild')");
        this._db.exec("INSERT INTO chat_chats_fts(chat_chats_fts) VALUES('rebuild')");
      } catch {
        // First-create path: tables are empty so rebuild may noop.
      }
      this._db.pragma(`user_version = ${SCHEMA_VERSION}`);
    }
  }

  // ---- Folders ------------------------------------------------------------

  createFolder(input: CreateFolderInput): Folder {
    const name = input.name.trim();
    if (!name) throw new Error("folder name is required");
    if (input.parentId !== null) {
      const parent = this._getFolderRow(input.parentId);
      if (!parent) throw new Error(`parent folder not found: ${input.parentId}`);
    }
    const id = randomUUID();
    const now = Date.now();
    this._db
      .prepare(
        `INSERT INTO chat_folders
           (id, parent_id, name, color, icon, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, input.parentId, name, input.color ?? null, input.icon ?? null, now, now);
    return {
      id,
      parentId: input.parentId,
      name,
      color: input.color ?? null,
      icon: input.icon ?? null,
      createdAt: now,
      updatedAt: now,
    };
  }

  renameFolder(id: string, name: string): Folder {
    const trimmed = name.trim();
    if (!trimmed) throw new Error("folder name is required");
    const existing = this._getFolderRow(id);
    if (!existing) throw new Error(`folder not found: ${id}`);
    const now = Date.now();
    this._db
      .prepare(`UPDATE chat_folders SET name = ?, updated_at = ? WHERE id = ?`)
      .run(trimmed, now, id);
    return { ...rowToFolder(existing), name: trimmed, updatedAt: now };
  }

  /**
   * Move a folder under a new parent. `newParentId === null` re-parents to
   * the root. Refuses to make a folder a descendant of itself.
   */
  moveFolder(id: string, newParentId: string | null): Folder {
    const existing = this._getFolderRow(id);
    if (!existing) throw new Error(`folder not found: ${id}`);
    if (newParentId === id) throw new Error("cannot move folder into itself");
    if (newParentId !== null) {
      const newParent = this._getFolderRow(newParentId);
      if (!newParent) throw new Error(`new parent folder not found: ${newParentId}`);
      if (this._isAncestor(id, newParentId)) {
        throw new Error("cannot move folder into its own descendant");
      }
    }
    const now = Date.now();
    this._db
      .prepare(`UPDATE chat_folders SET parent_id = ?, updated_at = ? WHERE id = ?`)
      .run(newParentId, now, id);
    return { ...rowToFolder(existing), parentId: newParentId, updatedAt: now };
  }

  /** Delete a folder and (via FK cascade) all descendant folders + chats. */
  deleteFolder(id: string): void {
    const existing = this._getFolderRow(id);
    if (!existing) return;
    this._db.prepare(`DELETE FROM chat_folders WHERE id = ?`).run(id);
  }

  getFolder(id: string): Folder | null {
    const row = this._getFolderRow(id);
    return row ? rowToFolder(row) : null;
  }

  // ---- Chats --------------------------------------------------------------

  createChat(input: CreateChatInput): Chat {
    const title = input.title.trim();
    if (!title) throw new Error("chat title is required");
    if (!input.modelId.trim()) throw new Error("chat modelId is required");
    if (input.folderId !== null) {
      const folder = this._getFolderRow(input.folderId);
      if (!folder) throw new Error(`folder not found: ${input.folderId}`);
    }
    const id = randomUUID();
    const now = Date.now();
    const contextScopeId =
      input.contextScopeId === undefined ? input.folderId : input.contextScopeId;
    this._db
      .prepare(
        `INSERT INTO chat_chats
           (id, folder_id, title, model_id, context_scope_id, created_at, updated_at, message_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
      )
      .run(id, input.folderId, title, input.modelId, contextScopeId, now, now);
    return {
      id,
      folderId: input.folderId,
      title,
      modelId: input.modelId,
      contextScopeId,
      createdAt: now,
      updatedAt: now,
      messageCount: 0,
    };
  }

  renameChat(id: string, title: string): Chat {
    const trimmed = title.trim();
    if (!trimmed) throw new Error("chat title is required");
    const existing = this._getChatRow(id);
    if (!existing) throw new Error(`chat not found: ${id}`);
    const now = Date.now();
    this._db
      .prepare(`UPDATE chat_chats SET title = ?, updated_at = ? WHERE id = ?`)
      .run(trimmed, now, id);
    return { ...rowToChat(existing), title: trimmed, updatedAt: now };
  }

  /**
   * Move a chat into a new folder. When `retagScope` is `true` (the default)
   * the chat's `contextScopeId` is updated to match the new folder; pass
   * `false` to preserve the existing scope (useful when scope tagging is
   * applied externally, e.g. by the MemoryHub adapter in 4.2).
   */
  moveChat(
    id: string,
    newFolderId: string | null,
    options: { retagScope?: boolean } = {},
  ): Chat {
    const existing = this._getChatRow(id);
    if (!existing) throw new Error(`chat not found: ${id}`);
    if (newFolderId !== null) {
      const folder = this._getFolderRow(newFolderId);
      if (!folder) throw new Error(`folder not found: ${newFolderId}`);
    }
    const retagScope = options.retagScope ?? true;
    const newScope = retagScope ? newFolderId : existing.context_scope_id;
    const now = Date.now();
    this._db
      .prepare(
        `UPDATE chat_chats
           SET folder_id = ?, context_scope_id = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(newFolderId, newScope, now, id);
    return {
      ...rowToChat(existing),
      folderId: newFolderId,
      contextScopeId: newScope,
      updatedAt: now,
    };
  }

  deleteChat(id: string): void {
    this._db.prepare(`DELETE FROM chat_chats WHERE id = ?`).run(id);
  }

  archiveChat(id: string, archivedAt = Date.now()): Chat {
    const tx = this._db.transaction(() => {
      const existing = this._getChatRow(id);
      if (!existing) throw new Error(`chat not found: ${id}`);
      if (existing.archived_at != null) return rowToChat(existing);
      this._db
        .prepare(
          `UPDATE chat_chats
              SET archived_folder_id = folder_id, folder_id = NULL, archived_at = ?, updated_at = ?
            WHERE id = ?`,
        )
        .run(archivedAt, archivedAt, id);
      return rowToChat({
        ...existing,
        folder_id: null,
        archived_folder_id: existing.folder_id,
        archived_at: archivedAt,
        updated_at: archivedAt,
      });
    });
    return tx();
  }

  restoreChat(id: string): { chat: Chat; parentFallback: boolean } {
    const tx = this._db.transaction(() => {
      const existing = this._db
        .prepare<[string], ChatRow>(`SELECT * FROM chat_chats WHERE id = ?`)
        .get(id);
      if (!existing || existing.archived_at == null) throw new Error(`archived chat not found: ${id}`);
      const archivedFolderId = existing.archived_folder_id ?? existing.folder_id;
      const parentFallback =
        archivedFolderId !== null && this._getFolderRow(archivedFolderId) === undefined;
      const folderId = parentFallback ? null : archivedFolderId;
      const now = Date.now();
      this._db
        .prepare(
          `UPDATE chat_chats
              SET folder_id = ?, archived_folder_id = NULL, archived_at = NULL, updated_at = ?
            WHERE id = ?`,
        )
        .run(folderId, now, id);
      return {
        chat: rowToChat({
          ...existing,
          folder_id: folderId,
          archived_folder_id: null,
          archived_at: null,
          updated_at: now,
        }),
        parentFallback,
      };
    });
    return tx();
  }

  listArchivedChats(): readonly import("./ChatExplorerStore.types.js").ArchivedChat[] {
    return this._db
      .prepare<unknown[], ChatRow>(
        `SELECT * FROM chat_chats WHERE archived_at IS NOT NULL ORDER BY archived_at DESC, title ASC`,
      )
      .all()
      .map(rowToChat)
      .filter((chat): chat is import("./ChatExplorerStore.types.js").ArchivedChat => chat.archivedAt != null);
  }

  getChat(id: string): Chat | null {
    const row = this._getChatRow(id);
    return row && row.archived_at == null ? rowToChat(row) : null;
  }

  bumpMessageCount(id: string, delta = 1): void {
    if (!Number.isFinite(delta)) throw new Error("delta must be finite");
    const now = Date.now();
    this._db
      .prepare(
        `UPDATE chat_chats
           SET message_count = MAX(0, message_count + ?), updated_at = ?
         WHERE id = ?`,
      )
      .run(delta, now, id);
  }

  // ---- Tree + search ------------------------------------------------------

  /**
   * Return the full nested tree. The synthetic root node has `folder = null`
   * and contains every top-level folder plus any chats whose `folderId` is
   * `null`.
   */
  listTree(): FolderTreeNode {
    const folders = this._db
      .prepare<unknown[], FolderRow>(`SELECT * FROM chat_folders ORDER BY name ASC`)
      .all();
    const chats = this._db
      .prepare<unknown[], ChatRow>(`SELECT * FROM chat_chats WHERE archived_at IS NULL ORDER BY title ASC`)
      .all();
    const byParent = new Map<string | null, Folder[]>();
    for (const row of folders) {
      const parent = row.parent_id;
      const bucket = byParent.get(parent) ?? [];
      bucket.push(rowToFolder(row));
      byParent.set(parent, bucket);
    }
    const chatsByFolder = new Map<string | null, Chat[]>();
    for (const row of chats) {
      const folderId = row.folder_id;
      const bucket = chatsByFolder.get(folderId) ?? [];
      bucket.push(rowToChat(row));
      chatsByFolder.set(folderId, bucket);
    }
    const buildNode = (folder: Folder | null): FolderTreeNode => {
      const parentKey = folder?.id ?? null;
      const childFolders = (byParent.get(parentKey) ?? []).map((child) => buildNode(child));
      return {
        folder,
        children: childFolders,
        chats: chatsByFolder.get(parentKey) ?? [],
      };
    };
    return buildNode(null);
  }

  /**
   * Search folders + chats by FTS5 over name/title. Returns up to `limit`
   * hits ordered by (folders first, then chats) and then by name/title.
   * Empty / whitespace queries return an empty list rather than every row.
   */
  search(query: string, limit = 25): readonly ChatExplorerSearchHit[] {
    const sanitized = sanitizeFtsQuery(query);
    if (!sanitized) return [];
    const folderRows = this._db
      .prepare<
        [string, number],
        { id: string; name: string; parent_id: string | null }
      >(
        `SELECT chat_folders.id, chat_folders.name, chat_folders.parent_id
           FROM chat_folders_fts
           JOIN chat_folders ON chat_folders.rowid = chat_folders_fts.rowid
          WHERE chat_folders_fts MATCH ?
          ORDER BY chat_folders.name ASC
          LIMIT ?`,
      )
      .all(sanitized, limit);
    const chatRows = this._db
      .prepare<
        [string, number],
        { id: string; title: string; folder_id: string | null }
      >(
        `SELECT chat_chats.id, chat_chats.title, chat_chats.folder_id
           FROM chat_chats_fts
           JOIN chat_chats ON chat_chats.rowid = chat_chats_fts.rowid
          WHERE chat_chats_fts MATCH ? AND chat_chats.archived_at IS NULL
          ORDER BY chat_chats.title ASC
          LIMIT ?`,
      )
      .all(sanitized, limit);
    const out: ChatExplorerSearchHit[] = [];
    for (const row of folderRows) {
      out.push({
        kind: "folder",
        id: row.id,
        name: row.name,
        parentId: row.parent_id,
      });
    }
    for (const row of chatRows) {
      out.push({
        kind: "chat",
        id: row.id,
        name: row.title,
        parentId: row.folder_id,
      });
    }
    return out.slice(0, limit);
  }

  /**
   * Walk the folder chain upwards. Returns the chain ordered root-first so
   * callers can render a breadcrumb without re-reversing. Returns an empty
   * array when `folderId` is `null` (root chat).
   */
  ancestors(folderId: string | null): readonly Folder[] {
    const chain: Folder[] = [];
    let cursor: string | null = folderId;
    const seen = new Set<string>();
    while (cursor !== null) {
      if (seen.has(cursor)) break; // defensive
      seen.add(cursor);
      const row = this._getFolderRow(cursor);
      if (!row) break;
      chain.push(rowToFolder(row));
      cursor = row.parent_id;
    }
    return chain.reverse();
  }

  /** Add a column when absent. Idempotent; safe on every construction. */
  private _addColumnIfMissing(table: string, column: string, definition: string): void {
    const columns = this._db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
      name: string;
    }>;
    if (columns.some((c) => c.name === column)) return;
    this._db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }

  // ---- Messages (v2.2.0 Phase 5) -----------------------------------------

  /** Append one message turn and bump the chat's counter in a single tx. */
  appendMessage(input: AppendMessageInput): ChatMessageRecord {
    const now = input.createdAt ?? Date.now();
    const id = input.id ?? `msg-${now}-${Math.random().toString(36).slice(2, 10)}`;
    const attachments =
      input.attachments && input.attachments.length > 0
        ? JSON.stringify(input.attachments)
        : null;
    const inputTokens = input.inputTokens ?? null;
    const reasoningTokens = input.reasoningTokens ?? null;
    const reasoningText = input.reasoningText
      ? redactSecrets(input.reasoningText).slice(0, 65_536)
      : null;
    const outputTokens = input.outputTokens ?? null;
    const tokensEstimated = input.tokensEstimated ? 1 : 0;
    // One transaction: a message that is stored but not counted (or the
    // reverse) would make the rail disagree with the conversation.
    const tx = this._db.transaction(() => {
      this._db
        .prepare(
          `INSERT INTO chat_chat_messages
             (id, chat_id, role, content, attachments, created_at,
              input_tokens, reasoning_tokens, reasoning_text, output_tokens, tokens_estimated)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.chatId,
          input.role,
          input.content,
          attachments,
          now,
          inputTokens,
          reasoningTokens,
          reasoningText,
          outputTokens,
          tokensEstimated,
        );
      this._db
        .prepare(
          `UPDATE chat_chats SET message_count = message_count + 1, updated_at = ?
           WHERE id = ?`,
        )
        .run(now, input.chatId);
    });
    tx();
    return {
      id,
      chatId: input.chatId,
      role: input.role,
      content: input.content,
      attachments: [...(input.attachments ?? [])],
      createdAt: now,
      inputTokens,
      reasoningTokens,
      reasoningText,
      outputTokens,
      tokensEstimated: tokensEstimated === 1,
    };
  }

  listMessages(chatId: string, limit = 500): readonly ChatMessageRecord[] {
    const rows = this._db
      .prepare(
        `SELECT * FROM chat_chat_messages WHERE chat_id = ?
         ORDER BY created_at ASC, rowid ASC LIMIT ?`,
      )
      .all(chatId, limit) as MessageRow[];
    return rows.map(rowToMessage);
  }

  /** Per-chat persona (system prompt). Persisted; previously React-only state. */
  setPersona(chatId: string, persona: string | null): void {
    this._db
      .prepare(`UPDATE chat_chats SET persona = ?, updated_at = ? WHERE id = ?`)
      .run(persona && persona.trim() ? persona : null, Date.now(), chatId);
  }

  /**
   * Rename by the USER, which pins the title against auto-titling.
   * `renameChat` stays the machine path so a generated title never sets it.
   */
  renameChatByUser(id: string, title: string): Chat {
    const chat = this.renameChat(id, title);
    this._db.prepare(`UPDATE chat_chats SET user_renamed = 1 WHERE id = ?`).run(id);
    return { ...chat, userRenamed: true };
  }

  close(): void {
    this._db.close();
  }

  // ---- internal -----------------------------------------------------------

  private _getFolderRow(id: string): FolderRow | undefined {
    return this._db
      .prepare<[string], FolderRow>(`SELECT * FROM chat_folders WHERE id = ?`)
      .get(id);
  }

  private _getChatRow(id: string): ChatRow | undefined {
    return this._db
      .prepare<[string], ChatRow>(`SELECT * FROM chat_chats WHERE id = ?`)
      .get(id);
  }

  /**
   * Returns true when `maybeDescendantId` lies in the sub-tree rooted at
   * `ancestorId`. Used to prevent move cycles.
   */
  private _isAncestor(ancestorId: string, maybeDescendantId: string): boolean {
    let cursor: string | null = maybeDescendantId;
    const seen = new Set<string>();
    while (cursor !== null) {
      if (seen.has(cursor)) return false;
      seen.add(cursor);
      const row = this._getFolderRow(cursor);
      if (!row) return false;
      if (row.parent_id === ancestorId) return true;
      cursor = row.parent_id;
    }
    return false;
  }
}
