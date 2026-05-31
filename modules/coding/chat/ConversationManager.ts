import * as vscode from "vscode";
import { randomUUID } from "crypto";
import type { Message, Role } from "./types.js";
import type { ChatHistoryStore } from "../../../src/storage/ChatHistoryStore.js";
import { stripLeadingThinkBlocks } from "../llm/Gemma4Parser.js";

/** Maximum characters used as the session title (truncated first user message). */
const SESSION_TITLE_MAX_CHARS = 60;

/**
 * v0.8.0 Phase 6.8 -- upper bound on the in-memory tool-call-bytes LRU.
 * Sized to cover ~3 long agent loops without unbounded growth.
 */
const MAX_TOOL_CALL_BYTES = 256;

export class ConversationManager {
  private readonly _messages: Message[] = [];
  private readonly _onDidChange = new vscode.EventEmitter<readonly Message[]>();
  readonly onDidChange = this._onDidChange.event;

  private _systemPrompt: string;
  private _sessionId: string | null = null;
  private _titleSet = false;

  /**
   * v0.7.0 Phase 4.6 -- buffer for messages the user typed while a stream
   * was active (queued via the webview's queued-message-field). The panel
   * drains this on the next idle tick. Cleared by `dropQueued()` when the
   * user clicks the stop button.
   */
  private _queuedMessages: string[] = [];

  /**
   * v0.8.0 Phase 6.8 (item E1) -- exact rendered tool-call bytes keyed by
   * `toolCallId`. On compaction replay the stored bytes are preferred over
   * re-rendering so the operator sees the same text the model originally
   * produced, char-for-char. LRU-bounded; see {@link MAX_TOOL_CALL_BYTES}.
   */
  private readonly _toolCallBytes = new Map<string, string>();

  // Running total of Message.content character lengths across all messages.
  // Maintained by every mutation path so estimators can read it in O(1)
  // without iterating the array. Divide by ~4 for a rough token estimate.
  private _totalChars = 0;

  constructor(
    systemPrompt: string,
    private readonly _store?: ChatHistoryStore,
  ) {
    this._systemPrompt = systemPrompt;
    this._append("system", systemPrompt);

    if (_store) {
      const existing = _store.listSessions(1);
      if (existing.length > 0 && existing[0]) {
        this._sessionId = existing[0].id;
      } else {
        const session = _store.createSession("New conversation");
        this._sessionId = session.id;
      }
    }
  }

  get sessionId(): string | null {
    return this._sessionId;
  }

  /**
   * Replace the system prompt in-place. Updates the first system message
   * in the message history and fires onDidChange. Used for mid-session
   * reconfiguration (e.g. plan mode toggle, skill activation).
   */
  rebuildSystemPrompt(newPrompt: string): void {
    this._systemPrompt = newPrompt;
    const systemMsg = this._messages[0];
    if (systemMsg && systemMsg.role === "system") {
      this._totalChars -= systemMsg.content.length;
      this._messages[0] = {
        id: systemMsg.id,
        role: "system",
        content: newPrompt,
        timestamp: Date.now(),
      };
      this._totalChars += newPrompt.length;
    }
    this._onDidChange.fire(this.getHistory());
  }

  private _append(role: Role, content: string): Message {
    const message: Message = {
      id: randomUUID(),
      role,
      content,
      timestamp: Date.now(),
    };
    this._messages.push(message);
    this._totalChars += content.length;

    // Persist non-system messages to the history store.
    if (this._store && this._sessionId && role !== "system") {
      this._store.saveMessage(this._sessionId, message);

      // Set session title from the first user message.
      if (role === "user" && !this._titleSet) {
        this._titleSet = true;
        const title =
          content.length > SESSION_TITLE_MAX_CHARS
            ? content.slice(0, SESSION_TITLE_MAX_CHARS) + "\u2026"
            : content;
        this._store.updateSessionTitle(this._sessionId, title);
      }
    }

    this._onDidChange.fire(this.getHistory());
    return message;
  }

  addUserMessage(content: string): Message {
    return this._append("user", content);
  }

  addAssistantMessage(content: string): Message {
    return this._append("assistant", content);
  }

  addSystemMessage(content: string): Message {
    return this._append("system", content);
  }

  getHistory(): readonly Message[] {
    return this._messages;
  }

  /**
   * v0.9.0 Phase 2.1 (from v0.8.0 known-gaps 10.O.K) -- conversation view
   * with hidden Gemma 4 reasoning stripped from assistant messages.
   *
   * Used by `ContextCompactor` (and any future replay surface) so the
   * compaction prompt does not re-feed `<think>` blocks back through the
   * model. User and system messages pass through unchanged.
   */
  replayForCompaction(): readonly Message[] {
    return this._messages.map((m) => {
      if (m.role !== "assistant") return m;
      const cleaned = stripLeadingThinkBlocks(m.content);
      if (cleaned === m.content) return m;
      return { ...m, content: cleaned };
    });
  }

  /** Current running total of message content chars. O(1). */
  get totalChars(): number {
    return this._totalChars;
  }

  clearHistory(): void {
    this._messages.length = 0;
    this._totalChars = 0;
    this._append("system", this._systemPrompt);

    // Start a fresh session on clear; keep the old one in history.
    if (this._store) {
      const session = this._store.createSession("New conversation");
      this._sessionId = session.id;
      this._titleSet = false;
    }
  }

  /**
   * Loads a prior session's messages into this manager, replacing the current
   * conversation. Used by the /history command to resume a past session.
   */
  loadSession(sessionId: string): boolean {
    if (!this._store) return false;
    const session = this._store.getSession(sessionId);
    if (!session) return false;

    this._messages.length = 0;
    this._totalChars = 0;
    // Always keep the system prompt as the first message.
    const systemMsg: Message = {
      id: randomUUID(),
      role: "system",
      content: this._systemPrompt,
      timestamp: Date.now(),
    };
    this._messages.push(systemMsg);
    this._totalChars += systemMsg.content.length;

    for (const msg of session.messages) {
      if (msg.role !== "system") {
        this._messages.push(msg as Message);
        this._totalChars += msg.content.length;
      }
    }

    this._sessionId = sessionId;
    this._titleSet = true;

    this._onDidChange.fire(this.getHistory());
    return true;
  }

  /**
   * Replaces the entire message list with the provided messages. Used by the
   * compaction pipeline to atomically swap in the compacted conversation.
   * The caller is responsible for preserving system messages.
   */
  replaceMessages(messages: readonly Message[]): void {
    this._messages.length = 0;
    this._totalChars = 0;
    for (const m of messages) {
      this._messages.push(m);
      this._totalChars += m.content.length;
    }

    this._onDidChange.fire(this.getHistory());
  }

  /**
   * Replaces conversation history with a compact summary, keeping the original
   * system prompt and the most recent `keepMessages` user+assistant messages.
   * Called by ContextCompactor after receiving a summary from the model.
   */
  replaceWithSummary(summary: string, keepMessages: number): void {
    const systemMessages = this._messages.filter((m) => m.role === "system");
    const nonSystem = this._messages.filter((m) => m.role !== "system");

    // Take the tail of non-system messages to preserve immediate context.
    const kept = nonSystem.slice(-keepMessages);

    const summaryMessage: Message = {
      id: randomUUID(),
      role: "assistant",
      content: `[Conversation summary]\n\n${summary}`,
      timestamp: Date.now(),
    };

    this._messages.length = 0;
    this._totalChars = 0;
    // Restore system messages first.
    for (const m of systemMessages) {
      this._messages.push(m);
      this._totalChars += m.content.length;
    }
    // Add the summary, then the most recent messages.
    this._messages.push(summaryMessage);
    this._totalChars += summaryMessage.content.length;
    for (const m of kept) {
      this._messages.push(m);
      this._totalChars += m.content.length;
    }

    this._onDidChange.fire(this.getHistory());
  }

  /**
   * Removes non-system messages from the front of the history until the
   * estimated token count (characters / 4) fits within maxTokens.
   * The seeded system message is always preserved.
   */
  trimToContextLimit(maxTokens: number): void {
    // Use the running counter for the fit check; no full-array reduce needed.
    if (this._totalChars / 4 <= maxTokens) return;

    // Single O(N) pass: scan non-system messages oldest-first, mark for
    // deletion until the remaining total fits, then rebuild the array once.
    let remaining = this._totalChars;
    const drop = new Set<number>();
    for (let i = 0; i < this._messages.length && remaining / 4 > maxTokens; i++) {
      const msg = this._messages[i];
      if (msg !== undefined && msg.role !== "system") {
        remaining -= msg.content.length;
        drop.add(i);
      }
    }

    if (drop.size === 0) return;

    const kept: Message[] = [];
    for (let i = 0; i < this._messages.length; i++) {
      if (!drop.has(i)) {
        const msg = this._messages[i];
        if (msg) kept.push(msg);
      }
    }
    this._messages.length = 0;
    for (const m of kept) this._messages.push(m);
    this._totalChars = remaining;

    this._onDidChange.fire(this.getHistory());
  }

  /** Phase 4.6 -- buffer a follow-up message while a stream is in flight. */
  enqueueMessage(text: string): void {
    const trimmed = text.trim();
    if (trimmed.length > 0) this._queuedMessages.push(trimmed);
  }

  /** Phase 4.6 -- drain the buffer (caller dispatches each as a new turn). */
  drainQueued(): string[] {
    const drained = this._queuedMessages.slice();
    this._queuedMessages.length = 0;
    return drained;
  }

  /** Phase 4.6 -- discard buffered follow-ups (stop button). */
  dropQueued(): void {
    this._queuedMessages.length = 0;
  }

  /** Phase 4.6 -- inspector for tests. */
  get queuedCount(): number {
    return this._queuedMessages.length;
  }

  // -------------------------------------------------------------------------
  // v0.8.0 Phase 6.8 -- tool-call exact-bytes replay
  // -------------------------------------------------------------------------

  /**
   * Persist the rendered bytes for a tool call. LRU-evict oldest entries
   * past {@link MAX_TOOL_CALL_BYTES}. Re-inserting an existing id moves it
   * to the end of the insertion order (LRU touch).
   *
   * v0.9.0 Phase 2.8: also write through to `ChatHistoryStore` (when wired
   * and the session id is known) so the bytes survive a session restart.
   * Failures here are non-fatal -- the in-memory LRU stays authoritative
   * for the live session.
   */
  storeToolCallBytes(toolCallId: string, bytes: string): void {
    if (this._toolCallBytes.has(toolCallId)) {
      this._toolCallBytes.delete(toolCallId);
    }
    this._toolCallBytes.set(toolCallId, bytes);
    while (this._toolCallBytes.size > MAX_TOOL_CALL_BYTES) {
      const oldest = this._toolCallBytes.keys().next().value;
      if (oldest === undefined) break;
      this._toolCallBytes.delete(oldest);
    }
    if (this._store && this._sessionId) {
      try {
        this._store.saveToolCallBytes(this._sessionId, toolCallId, bytes);
      } catch {
        // Non-fatal: in-memory LRU still serves the live session.
      }
    }
  }

  /**
   * Retrieve the rendered bytes for a tool call. Prefers the in-memory LRU;
   * falls through to the persistent `tool_call_bytes` table when wired so
   * bytes that pre-date this process invocation are still recoverable.
   */
  getToolCallBytes(toolCallId: string): string | null {
    const hit = this._toolCallBytes.get(toolCallId);
    if (hit !== undefined) return hit;
    if (this._store && this._sessionId) {
      try {
        return this._store.getToolCallBytes(this._sessionId, toolCallId);
      } catch {
        return null;
      }
    }
    return null;
  }

  /** Inspector for tests. */
  get toolCallBytesCount(): number {
    return this._toolCallBytes.size;
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}
