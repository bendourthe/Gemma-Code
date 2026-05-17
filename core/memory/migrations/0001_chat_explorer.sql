-- Phase 4 (v1.0.0) -- Chat Explorer schema.
--
-- Adds the two persistence surfaces consumed by the Local Chatbot Explorer
-- module:
--   * `chat_folders`  : nested-folder hierarchy keyed on `parent_id`.
--   * `chat_chats`    : chats bound to a folder, with model + scope metadata.
-- Plus FTS5 contentless-shadow indexes on `chat_folders.name` and
-- `chat_chats.title` to feed the dashboard top-bar search field.
--
-- The chat message rows are NOT created here; they continue to live in the
-- existing `chat_messages` / `sessions` tables managed by ChatHistoryStore
-- and are addressed by the `chat_chats.id` column at the application layer.
-- This file is checked in for reference and run by ChatExplorerStore at
-- construction time via `db.exec`. The schema is idempotent (`IF NOT
-- EXISTS`) so re-running on an already-migrated database is a no-op.

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
