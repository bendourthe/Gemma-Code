import * as vscode from "vscode";
import { randomUUID } from "crypto";
import type { Message, Role } from "./types.js";
import type { ChatHistoryStore } from "../storage/ChatHistoryStore.js";

const SYSTEM_PROMPT = `You are Gemma Code, a local agentic coding assistant running entirely offline via Ollama. You help developers understand, write, edit, and debug code across multiple files. Reason step-by-step, explain your thinking, and prefer clear, correct solutions over clever ones. Never fabricate file contents or API responses — always acknowledge uncertainty.

## Tool Use

You may invoke tools by emitting a JSON block inside your response, wrapped in XML tags:

<tool_call>
{
  "tool": "<tool_name>",
  "id": "<unique_id>",
  "parameters": { ... }
}
</tool_call>

After tool execution, the result will be injected into the conversation as:
<tool_result id="<unique_id>">
{ ...result JSON }
</tool_result>

Process the result and either call another tool or give your final answer. Do not fabricate tool results.

## Available Tools

- read_file: { path: string } — Read a file's content (up to 500 lines).
- write_file: { path: string; content: string } — Write or overwrite a file.
- edit_file: { path: string; old_string: string; new_string: string } — Replace an exact string in a file. old_string must appear exactly once.
- create_file: { path: string; content?: string } — Create a new file (fails if it already exists).
- delete_file: { path: string } — Delete a file.
- list_directory: { path?: string; recursive?: boolean } — List directory contents (3 levels deep max).
- grep_codebase: { pattern: string; glob?: string; max_results?: number } — Search files with a regex pattern.
- run_terminal: { command: string; cwd?: string } — Execute a shell command (requires user confirmation).
- web_search: { query: string; max_results?: number } — Search the web via DuckDuckGo (privacy-preserving).
- fetch_page: { url: string } — Fetch and read a web page as plain text (up to 2000 chars).

All paths are relative to the workspace root.`;

/** Maximum characters used as the session title (truncated first user message). */
const SESSION_TITLE_MAX_CHARS = 60;

export class ConversationManager {
  private readonly _messages: Message[] = [];
  private readonly _onDidChange = new vscode.EventEmitter<readonly Message[]>();
  readonly onDidChange = this._onDidChange.event;

  private _sessionId: string | null = null;
  private _titleSet = false;

  constructor(private readonly _store?: ChatHistoryStore) {
    this._append("system", SYSTEM_PROMPT);

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

  private _append(role: Role, content: string): Message {
    const message: Message = {
      id: randomUUID(),
      role,
      content,
      timestamp: Date.now(),
    };
    this._messages.push(message);

    // Persist non-system messages to the history store.
    if (this._store && this._sessionId && role !== "system") {
      this._store.saveMessage(this._sessionId, message);

      // Set session title from the first user message.
      if (role === "user" && !this._titleSet) {
        this._titleSet = true;
        const title =
          content.length > SESSION_TITLE_MAX_CHARS
            ? content.slice(0, SESSION_TITLE_MAX_CHARS) + "…"
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
    return [...this._messages];
  }

  clearHistory(): void {
    this._messages.length = 0;
    this._append("system", SYSTEM_PROMPT);

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
    // Always keep the system prompt as the first message.
    this._messages.push({
      id: randomUUID(),
      role: "system",
      content: SYSTEM_PROMPT,
      timestamp: Date.now(),
    });

    for (const msg of session.messages) {
      if (msg.role !== "system") {
        this._messages.push(msg as Message);
      }
    }

    this._sessionId = sessionId;
    this._titleSet = true;
    this._onDidChange.fire(this.getHistory());
    return true;
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
    // Restore system messages first.
    for (const m of systemMessages) this._messages.push(m);
    // Add the summary, then the most recent messages.
    this._messages.push(summaryMessage);
    for (const m of kept) this._messages.push(m);

    this._onDidChange.fire(this.getHistory());
  }

  /**
   * Removes non-system messages from the front of the history until the
   * estimated token count (characters / 4) fits within maxTokens.
   * The seeded system message is always preserved.
   */
  trimToContextLimit(maxTokens: number): void {
    let totalChars = this._messages.reduce((sum, m) => sum + m.content.length, 0);
    if (totalChars / 4 <= maxTokens) return;

    let i = 0;
    while (i < this._messages.length && totalChars / 4 > maxTokens) {
      const msg = this._messages[i];
      if (msg !== undefined && msg.role !== "system") {
        totalChars -= msg.content.length;
        this._messages.splice(i, 1);
      } else {
        i++;
      }
    }

    this._onDidChange.fire(this.getHistory());
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}
