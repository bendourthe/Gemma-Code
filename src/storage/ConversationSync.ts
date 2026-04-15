import * as fs from "fs";
import * as path from "path";
import type { Message } from "../chat/types.js";

/**
 * Syncs conversation messages to JSONL files in the workspace so the agent
 * can search its own history using grep_codebase. Each session gets a
 * separate file named by session ID.
 *
 * All file I/O is fire-and-forget: errors are logged but never thrown.
 */
export class ConversationSync {
  constructor(private readonly _syncDir: string) {}

  /**
   * Append a single message to the session's JSONL file.
   * Creates the directory and file if they do not exist.
   */
  syncMessage(sessionId: string, message: Message): void {
    try {
      this._ensureDir();
      const line = JSON.stringify({
        id: message.id,
        role: message.role,
        content: message.content,
        timestamp: message.timestamp,
      });
      fs.appendFileSync(this._filePath(sessionId), line + "\n", "utf-8");
    } catch {
      // Fire-and-forget: sync failures must never disrupt the conversation.
    }
  }

  /**
   * Overwrite the session file with all messages at once. Used after
   * compaction or when loading a prior session.
   */
  syncSession(sessionId: string, messages: readonly Message[]): void {
    try {
      this._ensureDir();
      const lines = messages.map((m) =>
        JSON.stringify({
          id: m.id,
          role: m.role,
          content: m.content,
          timestamp: m.timestamp,
        }),
      );
      fs.writeFileSync(this._filePath(sessionId), lines.join("\n") + "\n", "utf-8");
    } catch {
      // Fire-and-forget.
    }
  }

  /** Remove the JSONL file for a session. */
  deleteSession(sessionId: string): void {
    try {
      const fp = this._filePath(sessionId);
      if (fs.existsSync(fp)) {
        fs.unlinkSync(fp);
      }
    } catch {
      // Fire-and-forget.
    }
  }

  /** Returns the full file path for a session's JSONL file. */
  getSessionPath(sessionId: string): string {
    return this._filePath(sessionId);
  }

  /** List session IDs that have synced JSONL files. */
  listSyncedSessions(): string[] {
    try {
      if (!fs.existsSync(this._syncDir)) return [];
      return fs
        .readdirSync(this._syncDir)
        .filter((f) => f.endsWith(".jsonl"))
        .map((f) => f.replace(/\.jsonl$/, ""));
    } catch {
      return [];
    }
  }

  private _filePath(sessionId: string): string {
    return path.join(this._syncDir, `${sessionId}.jsonl`);
  }

  private _ensureDir(): void {
    if (!fs.existsSync(this._syncDir)) {
      fs.mkdirSync(this._syncDir, { recursive: true });
    }
  }
}
