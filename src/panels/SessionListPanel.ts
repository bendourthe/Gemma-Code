/**
 * Sidebar panel that shows a list of saved chat sessions.
 * Clicking a session opens the chat editor panel with that session loaded.
 * Clicking "New Session" opens a fresh chat editor panel.
 */
import * as vscode from "vscode";
import { randomUUID } from "node:crypto";
import type { ChatHistoryStore } from "../storage/ChatHistoryStore.js";
import { getWebviewHelpersScript } from "./webview/util.js";

export const SESSION_VIEW_ID = "gemma-code.chatView";

interface SessionListMessage {
  type: "newChat" | "openSession" | "ready";
  sessionId?: string;
}

export class SessionListPanel implements vscode.WebviewViewProvider {
  private _view: vscode.WebviewView | undefined;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _store: ChatHistoryStore | null,
    private readonly _onNewChat: () => void,
    private readonly _onOpenSession: (sessionId: string) => void,
  ) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    const nonce = randomUUID().replace(/-/g, "");
    const cspSource = webviewView.webview.cspSource;

    webviewView.webview.html = this._getHtml(nonce, cspSource);

    webviewView.webview.onDidReceiveMessage((msg: SessionListMessage) => {
      if (msg.type === "newChat") {
        this._onNewChat();
      } else if (msg.type === "openSession" && msg.sessionId) {
        this._onOpenSession(msg.sessionId);
      } else if (msg.type === "ready") {
        this._refreshSessions();
      }
    });
  }

  /** Refresh the session list in the sidebar. */
  refreshSessions(): void {
    this._refreshSessions();
  }

  private _refreshSessions(): void {
    if (!this._view || !this._store) return;
    const sessions = this._store.listSessions(50);
    void this._view.webview.postMessage({
      type: "sessions",
      sessions: sessions.map((s) => ({
        id: s.id,
        title: s.title,
        updatedAt: s.updatedAt,
        messageCount: s.messages.length,
      })),
    });
  }

  private _getHtml(nonce: string, cspSource: string): string {
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';" />
  <title>Gemma Code Sessions</title>
  <style nonce="${nonce}">
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--vscode-sideBar-background);
      color: var(--vscode-foreground);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    #header {
      padding: 12px 14px;
      display: flex;
      align-items: center;
      gap: 8px;
      border-bottom: 1px solid var(--vscode-panel-border);
    }
    #header h2 {
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      opacity: 0.7;
      flex: 1;
    }
    #new-chat-btn {
      font-size: 12px;
      padding: 4px 12px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-family: inherit;
    }
    #new-chat-btn:hover { background: var(--vscode-button-hoverBackground); }

    #search {
      margin: 8px 14px;
      padding: 6px 10px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 4px;
      font-family: inherit;
      font-size: 12px;
      width: calc(100% - 28px);
    }
    #search:focus { outline: none; border-color: var(--vscode-focusBorder); }
    #search::placeholder { color: var(--vscode-input-placeholderForeground); }

    #sessions {
      flex: 1;
      overflow-y: auto;
      padding: 4px 0;
    }
    .session-item {
      padding: 10px 14px;
      cursor: pointer;
      border-bottom: 1px solid rgba(128,128,128,0.1);
      transition: background 0.1s;
    }
    .session-item:hover {
      background: var(--vscode-list-hoverBackground);
    }
    .session-title {
      font-size: 13px;
      font-weight: 500;
      margin-bottom: 3px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .session-meta {
      font-size: 11px;
      opacity: 0.5;
      display: flex;
      gap: 8px;
    }
    #empty-state {
      padding: 40px 20px;
      text-align: center;
      opacity: 0.4;
      font-size: 13px;
    }
  </style>
</head>
<body>
  <div id="header">
    <h2>Sessions</h2>
    <button id="new-chat-btn">+ New Session</button>
  </div>
  <input id="search" type="text" placeholder="Search sessions..." />
  <div id="sessions">
    <div id="empty-state">No sessions yet. Click "New Session" to start.</div>
  </div>

  ${getWebviewHelpersScript(nonce)}
  <script nonce="${nonce}">
    (function() {
      'use strict';
      const vscode = acquireVsCodeApi();
      const sessionsEl = document.getElementById('sessions');
      const searchEl = document.getElementById('search');
      const newChatBtn = document.getElementById('new-chat-btn');
      const formatDate = window.__gemmaWebviewHelpers.formatDate;
      let allSessions = [];

      newChatBtn.addEventListener('click', () => {
        vscode.postMessage({ type: 'newChat' });
      });

      searchEl.addEventListener('input', () => {
        const q = searchEl.value.toLowerCase();
        renderSessions(allSessions.filter(s => s.title.toLowerCase().includes(q)));
      });

      function createSessionItem(s) {
        const item = document.createElement('div');
        item.className = 'session-item';
        item.dataset.id = s.id;

        const titleEl = document.createElement('div');
        titleEl.className = 'session-title';
        titleEl.textContent = s.title;

        const metaEl = document.createElement('div');
        metaEl.className = 'session-meta';

        const dateEl = document.createElement('span');
        dateEl.textContent = formatDate(s.updatedAt);

        const countEl = document.createElement('span');
        countEl.textContent = s.messageCount + ' messages';

        metaEl.appendChild(dateEl);
        metaEl.appendChild(countEl);
        item.appendChild(titleEl);
        item.appendChild(metaEl);

        item.addEventListener('click', () => {
          vscode.postMessage({ type: 'openSession', sessionId: s.id });
        });
        return item;
      }

      function createEmptyState(message) {
        const div = document.createElement('div');
        div.id = 'empty-state';
        div.textContent = message;
        return div;
      }

      function renderSessions(sessions) {
        if (sessions.length === 0) {
          sessionsEl.replaceChildren(createEmptyState('No sessions found.'));
          return;
        }
        sessionsEl.replaceChildren(...sessions.map(createSessionItem));
      }

      window.addEventListener('message', (e) => {
        const msg = e.data;
        if (msg.type === 'sessions') {
          allSessions = msg.sessions;
          searchEl.value = '';
          renderSessions(allSessions);
        }
      });

      vscode.postMessage({ type: 'ready' });
    })();
  </script>
</body>
</html>`;
  }
}
