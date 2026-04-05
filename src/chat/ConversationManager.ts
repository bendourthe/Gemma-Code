import * as vscode from "vscode";
import { randomUUID } from "crypto";
import type { Message, Role } from "./types.js";

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

export class ConversationManager {
  private readonly _messages: Message[] = [];
  private readonly _onDidChange = new vscode.EventEmitter<readonly Message[]>();
  readonly onDidChange = this._onDidChange.event;

  constructor() {
    this._append("system", SYSTEM_PROMPT);
  }

  private _append(role: Role, content: string): Message {
    const message: Message = {
      id: randomUUID(),
      role,
      content,
      timestamp: Date.now(),
    };
    this._messages.push(message);
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
