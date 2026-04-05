import * as vscode from "vscode";
import { randomUUID } from "crypto";
import type { Message, Role } from "./types.js";

const SYSTEM_PROMPT =
  "You are Gemma Code, a local agentic coding assistant running entirely " +
  "offline via Ollama. You help developers understand, write, edit, and debug " +
  "code across multiple files. Reason step-by-step, explain your thinking, and " +
  "prefer clear, correct solutions over clever ones. When you need to perform " +
  "actions (read files, run commands, edit code), describe them clearly and wait " +
  "for confirmation. Never fabricate file contents or API responses — always " +
  "acknowledge uncertainty.";

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
